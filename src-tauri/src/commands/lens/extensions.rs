//! Browser extensions manager (Tier 3 marquee).
//!
//! WebView2 can load unpacked Chromium extensions once the environment is
//! created with `AreBrowserExtensionsEnabled` (set via the main window's
//! `browserExtensionsEnabled` in `tauri.conf.json` — it is ENVIRONMENT-wide, so
//! every child webview shares it; enabling it needs an app restart).
//!
//! ## How the pieces fit
//!
//! - Extensions are managed through `ICoreWebView2Profile7` (Add / Get). We reach
//!   it from any active tab's webview: `ICoreWebView2_13::Profile()` → cast to
//!   `ICoreWebView2Profile7`. The profile is shared across the environment, so
//!   the active tab is just a handle onto it — but at least ONE browser tab must
//!   be open (that's the only webview we can reach the profile through).
//! - The unpacked extension is COPIED into a managed dir
//!   (`get_data_dir()/extensions/<slug>/`) and WebView2 is pointed at the COPY.
//!   CRITICAL: WebView2 drops an extension if its source folder changes after
//!   install, so the managed copy is treated as immutable — we only ever create
//!   it (install) or delete it whole (remove).
//! - `index.json` in that dir maps our managed folder → WebView2's assigned
//!   extension id + the popup path parsed from `manifest.json`. WebView2 renders
//!   NO extension UI, so the toolbar opens `chrome-extension://<id>/<popup>` in a
//!   normal tab itself; the id↔popup correlation is what makes that possible.
//! - CRX install: a CRX3 file is a header followed by a plain zip. We locate the
//!   first `PK\x03\x04` local-file signature and unzip from there — this works
//!   for CRX2 and CRX3 without parsing the (differing) headers. URLs are
//!   downloaded first (Chrome Web Store CRX endpoint, redirect-followed).
//!
//! The COM async operations (Get/Add/Enable/Remove) complete on the WebView2 UI
//! thread. We register a completion handler that sends the result down an mpsc
//! channel and `recv_timeout` from the calling (non-UI) thread — the same shape
//! as `report_page_title` / `lens_toggle_tab_mute`.

use super::super::IpcResponse;
use super::LensState;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ── Managed store on disk ────────────────────────────────────────────────────

/// Root of the managed unpacked-extension copies.
fn extensions_dir() -> std::path::PathBuf {
    crate::services::platform::get_data_dir().join("extensions")
}

fn index_path() -> std::path::PathBuf {
    extensions_dir().join("index.json")
}

/// One managed extension: our folder + the WebView2 id + parsed popup path.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    /// WebView2's assigned extension id (32-char), captured at install time.
    id: String,
    /// Managed folder name under `extensions/`.
    dir: String,
    /// Extension display name (i18n-resolved when possible).
    name: String,
    /// Popup path relative to the extension root (from the manifest), or "".
    popup: String,
    /// Where it came from: "folder", a crx path, or a URL — informational.
    source: String,
}

fn read_index() -> Vec<IndexEntry> {
    if let Ok(data) = std::fs::read_to_string(index_path()) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn write_index(entries: &[IndexEntry]) {
    if let Err(e) = std::fs::create_dir_all(extensions_dir()) {
        tracing::warn!("[lens] extensions dir create failed: {e}");
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(index_path(), json);
    }
}

fn upsert_index(entry: IndexEntry) {
    let mut entries = read_index();
    // De-dupe by managed dir (a reinstall of the same folder updates in place).
    entries.retain(|e| e.dir != entry.dir);
    entries.push(entry);
    write_index(&entries);
}

// ── Manifest parsing (name + popup + i18n) ───────────────────────────────────

/// Resolve `__MSG_key__` placeholders against `_locales/<default_locale>/messages.json`.
/// Falls back to the raw string when anything is missing.
fn resolve_i18n(raw: &str, ext_root: &std::path::Path, default_locale: &str) -> String {
    let key = raw
        .strip_prefix("__MSG_")
        .and_then(|s| s.strip_suffix("__"));
    let Some(key) = key else { return raw.to_string() };
    if default_locale.is_empty() {
        return raw.to_string();
    }
    let messages_path = ext_root
        .join("_locales")
        .join(default_locale)
        .join("messages.json");
    let Ok(data) = std::fs::read_to_string(messages_path) else {
        return raw.to_string();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) else {
        return raw.to_string();
    };
    // messages.json keys are case-insensitive in Chrome; try exact then ci.
    let lookup = json.get(key).or_else(|| {
        json.as_object().and_then(|m| {
            m.iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v)
        })
    });
    lookup
        .and_then(|v| v.get("message"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| raw.to_string())
}

/// Read `manifest.json` from an extension root; return (display_name, popup_path).
/// popup_path is "" when the extension declares no browser-action popup.
fn read_manifest(ext_root: &std::path::Path) -> Result<(String, String), String> {
    let manifest_path = ext_root.join("manifest.json");
    let data = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("No manifest.json in {}: {e}", ext_root.display()))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Invalid manifest.json: {e}"))?;

    let default_locale = manifest
        .get("default_locale")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let raw_name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Extension");
    let name = resolve_i18n(raw_name, ext_root, default_locale);

    // MV3 `action`, MV2 `browser_action` / `page_action`.
    let popup = ["action", "browser_action", "page_action"]
        .iter()
        .find_map(|k| {
            manifest
                .get(*k)
                .and_then(|a| a.get("default_popup"))
                .and_then(|p| p.as_str())
        })
        .unwrap_or("")
        .to_string();

    Ok((name, popup))
}

// ── Filesystem helpers ───────────────────────────────────────────────────────

fn slugify(name: &str) -> String {
    let mut slug: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() { "extension".to_string() } else { slug }
}

/// Pick a non-colliding managed folder for `base_slug`.
fn unique_managed_dir(base_slug: &str) -> std::path::PathBuf {
    let root = extensions_dir();
    let mut candidate = root.join(base_slug);
    let mut n = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base_slug}-{n}"));
        n += 1;
    }
    candidate
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
        // Symlinks/other are skipped — extensions are plain files.
    }
    Ok(())
}

/// Locate the first ZIP local-file-header signature (`PK\x03\x04`). A CRX3 file
/// is `Cr24` + version + header-len + protobuf header + this zip; a bare zip
/// starts with it directly. Returns the byte offset of the zip payload.
fn find_zip_offset(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|w| w == [0x50, 0x4B, 0x03, 0x04])
}

/// Extract the zip embedded in CRX (or a bare zip) into `dst`.
fn extract_crx_zip(bytes: &[u8], dst: &std::path::Path) -> Result<(), String> {
    let offset = find_zip_offset(bytes)
        .ok_or_else(|| "Not a valid CRX/ZIP (no PK header found)".to_string())?;
    let cursor = std::io::Cursor::new(&bytes[offset..]);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Zip open failed: {e}"))?;
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir failed: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry {i} failed: {e}"))?;
        // `enclosed_name` rejects path traversal (`..`, absolute paths).
        let Some(rel) = file.enclosed_name() else { continue };
        let out_path = dst.join(rel);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("mkdir failed: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {} failed: {e}", out_path.display()))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| format!("write {} failed: {e}", out_path.display()))?;
        }
    }
    Ok(())
}

// ── COM plumbing (Windows only) ──────────────────────────────────────────────

/// Add an extension folder through the active tab's profile; returns the id
/// WebView2 assigned. Blocks (on a non-UI thread) up to 15s for the async op.
#[cfg(windows)]
fn add_extension_blocking(webview: tauri::Webview, folder: String) -> Result<String, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtension, ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{take_pwstr, ProfileAddBrowserExtensionCompletedHandler};
    use windows_core::{Interface, HSTRING, PCWSTR, PWSTR};

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let dispatch = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let core = match controller.CoreWebView2() {
            Ok(c) => c,
            Err(e) => { let _ = tx.send(Err(format!("No CoreWebView2: {e:?}"))); return; }
        };
        let wv13: ICoreWebView2_13 = match core.cast() {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("ICoreWebView2_13 unavailable: {e:?}"))); return; }
        };
        let profile = match wv13.Profile() {
            Ok(p) => p,
            Err(e) => { let _ = tx.send(Err(format!("Profile() failed: {e:?}"))); return; }
        };
        let profile7: ICoreWebView2Profile7 = match profile.cast() {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("Extensions not supported (ICoreWebView2Profile7 unavailable — restart Voice Mirror after enabling extensions): {e:?}"))); return; }
        };
        let hs = HSTRING::from(folder.as_str());
        let tx_h = tx.clone();
        let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |hr, ext: Option<ICoreWebView2BrowserExtension>| {
                if hr.is_ok() {
                    if let Some(ext) = ext {
                        let mut idp = PWSTR::null();
                        let _ = ext.Id(&mut idp);
                        let _ = tx_h.send(Ok(take_pwstr(idp)));
                    } else {
                        let _ = tx_h.send(Ok(String::new()));
                    }
                } else {
                    let _ = tx_h.send(Err(format!("AddBrowserExtension failed: {hr:?}")));
                }
                Ok(())
            },
        ));
        if let Err(e) = profile7.AddBrowserExtension(PCWSTR(hs.as_ptr()), &handler) {
            let _ = tx.send(Err(format!("AddBrowserExtension call failed: {e:?}")));
        }
    });
    if dispatch.is_err() {
        return Err("Could not reach the browser webview".into());
    }
    match rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(r) => r,
        Err(_) => Err("Timed out installing extension".into()),
    }
}

/// List extensions on the active tab's profile: (id, name, enabled).
#[cfg(windows)]
fn list_extensions_blocking(webview: tauri::Webview) -> Result<Vec<(String, String, bool)>, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{take_pwstr, ProfileGetBrowserExtensionsCompletedHandler};
    use windows_core::{Interface, BOOL, PWSTR};

    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<(String, String, bool)>, String>>();
    let dispatch = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let core = match controller.CoreWebView2() {
            Ok(c) => c,
            Err(e) => { let _ = tx.send(Err(format!("No CoreWebView2: {e:?}"))); return; }
        };
        let wv13: ICoreWebView2_13 = match core.cast() {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("ICoreWebView2_13 unavailable: {e:?}"))); return; }
        };
        let profile7: ICoreWebView2Profile7 = match wv13.Profile().and_then(|p| p.cast()) {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("Extensions not supported (restart Voice Mirror after enabling extensions): {e:?}"))); return; }
        };
        let tx_h = tx.clone();
        let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
            move |hr, list: Option<ICoreWebView2BrowserExtensionList>| {
                if !hr.is_ok() {
                    let _ = tx_h.send(Err(format!("GetBrowserExtensions failed: {hr:?}")));
                    return Ok(());
                }
                let mut out: Vec<(String, String, bool)> = Vec::new();
                if let Some(list) = list {
                    let mut count = 0u32;
                    if list.Count(&mut count).is_ok() {
                        for i in 0..count {
                            if let Ok(ext) = list.GetValueAtIndex(i) {
                                let mut idp = PWSTR::null();
                                let _ = ext.Id(&mut idp);
                                let id = take_pwstr(idp);
                                let mut namep = PWSTR::null();
                                let _ = ext.Name(&mut namep);
                                let name = take_pwstr(namep);
                                let mut en = BOOL::default();
                                let _ = ext.IsEnabled(&mut en);
                                out.push((id, name, en.as_bool()));
                            }
                        }
                    }
                }
                let _ = tx_h.send(Ok(out));
                Ok(())
            },
        ));
        if let Err(e) = profile7.GetBrowserExtensions(&handler) {
            let _ = tx.send(Err(format!("GetBrowserExtensions call failed: {e:?}")));
        }
    });
    if dispatch.is_err() {
        return Err("Could not reach the browser webview".into());
    }
    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(_) => Err("Timed out listing extensions".into()),
    }
}

/// Enable or disable an extension by id. Requires a Get to obtain the object,
/// then `Enable` on it — both async, chained on the UI thread.
#[cfg(windows)]
fn set_enabled_blocking(webview: tauri::Webview, id: String, enabled: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{
        take_pwstr, BrowserExtensionEnableCompletedHandler,
        ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows_core::{Interface, PWSTR};

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let dispatch = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let profile7: ICoreWebView2Profile7 = match controller
            .CoreWebView2()
            .and_then(|c| c.cast::<ICoreWebView2_13>())
            .and_then(|w| w.Profile())
            .and_then(|p| p.cast())
        {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("Extensions not supported: {e:?}"))); return; }
        };
        let tx_get = tx.clone();
        let get_handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
            move |hr, list: Option<ICoreWebView2BrowserExtensionList>| {
                if !hr.is_ok() {
                    let _ = tx_get.send(Err(format!("GetBrowserExtensions failed: {hr:?}")));
                    return Ok(());
                }
                let Some(list) = list else {
                    let _ = tx_get.send(Err("Extension not found".into()));
                    return Ok(());
                };
                let mut count = 0u32;
                let _ = list.Count(&mut count);
                for i in 0..count {
                    if let Ok(ext) = list.GetValueAtIndex(i) {
                        let mut idp = PWSTR::null();
                        let _ = ext.Id(&mut idp);
                        if take_pwstr(idp) == id {
                            let tx_enable = tx_get.clone();
                            let enable_handler =
                                BrowserExtensionEnableCompletedHandler::create(Box::new(move |hr2| {
                                    if hr2.is_ok() {
                                        let _ = tx_enable.send(Ok(()));
                                    } else {
                                        let _ = tx_enable.send(Err(format!("Enable failed: {hr2:?}")));
                                    }
                                    Ok(())
                                }));
                            if let Err(e) = ext.Enable(enabled, &enable_handler) {
                                let _ = tx_get.send(Err(format!("Enable call failed: {e:?}")));
                            }
                            return Ok(());
                        }
                    }
                }
                let _ = tx_get.send(Err("Extension not found".into()));
                Ok(())
            },
        ));
        if let Err(e) = profile7.GetBrowserExtensions(&get_handler) {
            let _ = tx.send(Err(format!("GetBrowserExtensions call failed: {e:?}")));
        }
    });
    if dispatch.is_err() {
        return Err("Could not reach the browser webview".into());
    }
    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(_) => Err("Timed out updating extension".into()),
    }
}

/// Remove an extension by id from the WebView2 profile (does NOT touch disk).
#[cfg(windows)]
fn remove_extension_blocking(webview: tauri::Webview, id: String) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{
        take_pwstr, BrowserExtensionRemoveCompletedHandler,
        ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows_core::{Interface, PWSTR};

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let dispatch = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let profile7: ICoreWebView2Profile7 = match controller
            .CoreWebView2()
            .and_then(|c| c.cast::<ICoreWebView2_13>())
            .and_then(|w| w.Profile())
            .and_then(|p| p.cast())
        {
            Ok(v) => v,
            Err(e) => { let _ = tx.send(Err(format!("Extensions not supported: {e:?}"))); return; }
        };
        let tx_get = tx.clone();
        let get_handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
            move |hr, list: Option<ICoreWebView2BrowserExtensionList>| {
                if !hr.is_ok() {
                    let _ = tx_get.send(Err(format!("GetBrowserExtensions failed: {hr:?}")));
                    return Ok(());
                }
                let Some(list) = list else {
                    let _ = tx_get.send(Err("Extension not found".into()));
                    return Ok(());
                };
                let mut count = 0u32;
                let _ = list.Count(&mut count);
                for i in 0..count {
                    if let Ok(ext) = list.GetValueAtIndex(i) {
                        let mut idp = PWSTR::null();
                        let _ = ext.Id(&mut idp);
                        if take_pwstr(idp) == id {
                            let tx_remove = tx_get.clone();
                            let remove_handler =
                                BrowserExtensionRemoveCompletedHandler::create(Box::new(move |hr2| {
                                    if hr2.is_ok() {
                                        let _ = tx_remove.send(Ok(()));
                                    } else {
                                        let _ = tx_remove.send(Err(format!("Remove failed: {hr2:?}")));
                                    }
                                    Ok(())
                                }));
                            if let Err(e) = ext.Remove(&remove_handler) {
                                let _ = tx_get.send(Err(format!("Remove call failed: {e:?}")));
                            }
                            return Ok(());
                        }
                    }
                }
                let _ = tx_get.send(Err("Extension not found".into()));
                Ok(())
            },
        ));
        if let Err(e) = profile7.GetBrowserExtensions(&get_handler) {
            let _ = tx.send(Err(format!("GetBrowserExtensions call failed: {e:?}")));
        }
    });
    if dispatch.is_err() {
        return Err("Could not reach the browser webview".into());
    }
    match rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(r) => r,
        Err(_) => Err("Timed out removing extension".into()),
    }
}

// ── Shared result shaping ────────────────────────────────────────────────────

/// Merge the live WebView2 list with our on-disk index so each entry carries a
/// popup path + managed dir. Matches by id, then falls back to name.
fn shape_list(live: Vec<(String, String, bool)>) -> serde_json::Value {
    let index = read_index();
    let extensions: Vec<serde_json::Value> = live
        .into_iter()
        .map(|(id, name, enabled)| {
            let meta = index
                .iter()
                .find(|e| !e.id.is_empty() && e.id == id)
                .or_else(|| index.iter().find(|e| e.name == name));
            serde_json::json!({
                "id": id,
                "name": name,
                "enabled": enabled,
                "popup": meta.map(|m| m.popup.clone()).unwrap_or_default(),
                "dir": meta.map(|m| m.dir.clone()).unwrap_or_default(),
            })
        })
        .collect();
    serde_json::json!({ "extensions": extensions })
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// List installed extensions (id, name, enabled, popup, dir).
#[tauri::command]
pub fn lens_extensions_list(app: AppHandle, state: tauri::State<'_, LensState>) -> IpcResponse {
    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => {
            return IpcResponse::err(
                "Open a browser tab to manage extensions (the extensions profile is reached through a tab).",
            )
        }
    };
    #[cfg(windows)]
    {
        match list_extensions_blocking(webview) {
            Ok(live) => IpcResponse::ok(shape_list(live)),
            Err(e) => IpcResponse::err(e),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = webview;
        IpcResponse::err("Browser extensions are Windows-only")
    }
}

/// Install an unpacked extension from a local folder: copy into the managed dir,
/// then point WebView2 at the copy.
#[tauri::command]
pub fn lens_extension_add(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
    folder: String,
) -> IpcResponse {
    let src = std::path::PathBuf::from(&folder);
    if !src.join("manifest.json").exists() {
        return IpcResponse::err("That folder has no manifest.json — pick an unpacked extension folder.");
    }
    let (name, popup) = match read_manifest(&src) {
        Ok(v) => v,
        Err(e) => return IpcResponse::err(e),
    };
    let managed = unique_managed_dir(&slugify(&name));
    if let Err(e) = copy_dir_all(&src, &managed) {
        return IpcResponse::err(format!("Copy into managed dir failed: {e}"));
    }

    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&managed);
            return IpcResponse::err("Open a browser tab first, then install the extension.");
        }
    };
    finish_install(&app, &state, webview, &managed, name, popup, folder)
}

/// Install from a CRX file path or a URL (Chrome Web Store CRX endpoint). CRX3 =
/// header + zip; we unzip from the first PK signature into the managed dir.
#[tauri::command]
pub async fn lens_extension_install_crx(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
    source: String,
) -> Result<IpcResponse, String> {
    // Fetch the CRX bytes (URL → download; else read the local file).
    let bytes: Vec<u8> = if source.starts_with("http://") || source.starts_with("https://") {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;
        let resp = client
            .get(&source)
            .send()
            .await
            .map_err(|e| format!("Download failed: {e}"))?;
        if !resp.status().is_success() {
            return Ok(IpcResponse::err(format!(
                "Download failed: HTTP {}",
                resp.status()
            )));
        }
        resp.bytes()
            .await
            .map_err(|e| format!("Read body failed: {e}"))?
            .to_vec()
    } else {
        std::fs::read(&source).map_err(|e| format!("Read {source} failed: {e}"))?
    };

    // Unzip into a temp dir first so a bad archive never leaves a half copy.
    let staging = extensions_dir().join(format!(".staging-{}", uuid::Uuid::new_v4()));
    if let Err(e) = extract_crx_zip(&bytes, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Ok(IpcResponse::err(e));
    }
    let (name, popup) = match read_manifest(&staging) {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Ok(IpcResponse::err(e));
        }
    };
    let managed = unique_managed_dir(&slugify(&name));
    if let Err(e) = std::fs::rename(&staging, &managed) {
        // Cross-volume rename can fail; fall back to copy.
        if copy_dir_all(&staging, &managed).is_err() {
            let _ = std::fs::remove_dir_all(&staging);
            return Ok(IpcResponse::err(format!("Move into managed dir failed: {e}")));
        }
        let _ = std::fs::remove_dir_all(&staging);
    }

    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&managed);
            return Ok(IpcResponse::err(
                "Open a browser tab first, then install the extension.",
            ));
        }
    };

    // COM add on a blocking thread (its recv would otherwise stall the runtime).
    #[cfg(windows)]
    {
        let managed_str = managed.to_string_lossy().to_string();
        let managed_clone = managed.clone();
        let res = tauri::async_runtime::spawn_blocking(move || {
            add_extension_blocking(webview, managed_str)
        })
        .await
        .map_err(|e| format!("join error: {e}"))?;
        match res {
            Ok(id) => {
                let dir = managed
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                upsert_index(IndexEntry { id, dir, name, popup, source });
                Ok(IpcResponse::ok(build_list_after(&app, &state)))
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&managed_clone);
                Ok(IpcResponse::err(e))
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, &managed, name, popup, source);
        let _ = std::fs::remove_dir_all(&managed);
        Ok(IpcResponse::err("Browser extensions are Windows-only"))
    }
}

/// Enable or disable an installed extension.
#[tauri::command]
pub fn lens_extension_set_enabled(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
    id: String,
    enabled: bool,
) -> IpcResponse {
    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => return IpcResponse::err("Open a browser tab to manage extensions."),
    };
    #[cfg(windows)]
    {
        match set_enabled_blocking(webview, id, enabled) {
            Ok(()) => IpcResponse::ok(build_list_after(&app, &state)),
            Err(e) => IpcResponse::err(e),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, id, enabled);
        IpcResponse::err("Browser extensions are Windows-only")
    }
}

/// Remove an installed extension (WebView2 + managed folder + index entry).
#[tauri::command]
pub fn lens_extension_remove(
    app: AppHandle,
    state: tauri::State<'_, LensState>,
    id: String,
) -> IpcResponse {
    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => return IpcResponse::err("Open a browser tab to manage extensions."),
    };
    #[cfg(windows)]
    {
        if let Err(e) = remove_extension_blocking(webview, id.clone()) {
            return IpcResponse::err(e);
        }
        // Delete the managed folder + index entry (best-effort).
        let mut index = read_index();
        if let Some(pos) = index.iter().position(|e| e.id == id) {
            let dir = index[pos].dir.clone();
            if !dir.is_empty() {
                let _ = std::fs::remove_dir_all(extensions_dir().join(dir));
            }
            index.remove(pos);
            write_index(&index);
        }
        IpcResponse::ok(build_list_after(&app, &state))
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, id);
        IpcResponse::err("Browser extensions are Windows-only")
    }
}

// ── Internal ─────────────────────────────────────────────────────────────────

/// Shared tail of the folder-install path: COM add, record the id, return list.
#[cfg(windows)]
fn finish_install(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
    webview: tauri::Webview,
    managed: &std::path::Path,
    name: String,
    popup: String,
    source: String,
) -> IpcResponse {
    let managed_str = managed.to_string_lossy().to_string();
    match add_extension_blocking(webview, managed_str) {
        Ok(id) => {
            let dir = managed
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            upsert_index(IndexEntry { id, dir, name, popup, source });
            IpcResponse::ok(build_list_after(app, state))
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(managed);
            IpcResponse::err(e)
        }
    }
}

#[cfg(not(windows))]
fn finish_install(
    _app: &AppHandle,
    _state: &tauri::State<'_, LensState>,
    _webview: tauri::Webview,
    managed: &std::path::Path,
    _name: String,
    _popup: String,
    _source: String,
) -> IpcResponse {
    let _ = std::fs::remove_dir_all(managed);
    IpcResponse::err("Browser extensions are Windows-only")
}

/// Build a fresh list payload from the live profile (best-effort; empty on error).
fn build_list_after(app: &AppHandle, state: &tauri::State<'_, LensState>) -> serde_json::Value {
    #[cfg(windows)]
    {
        if let Ok(webview) = super::get_lens_webview(app, state) {
            if let Ok(live) = list_extensions_blocking(webview) {
                return shape_list(live);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
    }
    serde_json::json!({ "extensions": [] })
}

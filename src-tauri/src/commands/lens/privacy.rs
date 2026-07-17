//! Browser privacy toggles (Tier 3 best-effort).
//!
//! WebView2 exposes a few privacy knobs on the profile:
//! - tracking-prevention level  (`ICoreWebView2Profile3::SetPreferredTrackingPreventionLevel`)
//! - password autosave          (`ICoreWebView2Profile6::SetIsPasswordAutosaveEnabled`)
//! - general form autofill      (`ICoreWebView2Profile6::SetIsGeneralAutofillEnabled`)
//!
//! These are per-profile and persist in the WebView2 user-data folder, so a
//! single apply sticks across restarts. The source of truth is the persisted
//! config (`browser.trackingPrevention` / `passwordAutosave` / `generalAutofill`);
//! `lens_apply_privacy` reaches the active tab's profile and applies the current
//! values. `apply_privacy_to_webview` runs the same logic at tab-creation time so
//! a fresh profile is configured immediately (both no-op off the Windows path).

use super::super::IpcResponse;
use super::LensState;
use tauri::AppHandle;

/// Apply the persisted privacy config to a webview's profile. Synchronous COM
/// (no async completion). Reports via an mpsc channel + `recv_timeout`, matching
/// the other lens COM commands.
#[cfg(windows)]
pub(super) fn apply_privacy_to_webview(webview: &tauri::Webview) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile3, ICoreWebView2Profile6, ICoreWebView2_13,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BASIC,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT,
    };
    use windows_core::Interface;

    let cfg = crate::commands::config::get_config_snapshot().browser;
    let level = match cfg.tracking_prevention.as_str() {
        "off" | "none" => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
        "basic" => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BASIC,
        "strict" => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT,
        _ => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED,
    };
    let password_autosave = cfg.password_autosave;
    let general_autofill = cfg.general_autofill;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let dispatch = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let profile = match controller
            .CoreWebView2()
            .and_then(|c| c.cast::<ICoreWebView2_13>())
            .and_then(|w| w.Profile())
        {
            Ok(p) => p,
            Err(e) => { let _ = tx.send(Err(format!("Profile() failed: {e:?}"))); return; }
        };
        // Tracking prevention (Profile3).
        if let Ok(p3) = profile.cast::<ICoreWebView2Profile3>() {
            let _ = p3.SetPreferredTrackingPreventionLevel(level);
        }
        // Password autosave + general autofill (Profile6).
        if let Ok(p6) = profile.cast::<ICoreWebView2Profile6>() {
            let _ = p6.SetIsPasswordAutosaveEnabled(password_autosave);
            let _ = p6.SetIsGeneralAutofillEnabled(general_autofill);
        }
        let _ = tx.send(Ok(()));
    });
    if dispatch.is_err() {
        return Err("Could not reach the browser webview".into());
    }
    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(r) => r,
        Err(_) => Err("Timed out applying privacy settings".into()),
    }
}

#[cfg(not(windows))]
pub(super) fn apply_privacy_to_webview(_webview: &tauri::Webview) -> Result<(), String> {
    Ok(())
}

/// Apply the persisted privacy config to the active tab's profile. Called after
/// the frontend saves the toggles; persists on the profile for all tabs.
#[tauri::command]
pub fn lens_apply_privacy(app: AppHandle, state: tauri::State<'_, LensState>) -> IpcResponse {
    let webview = match super::get_lens_webview(&app, &state) {
        Ok(w) => w,
        Err(_) => {
            return IpcResponse::err(
                "Open a browser tab to apply privacy settings (they attach to the browser profile).",
            )
        }
    };
    match apply_privacy_to_webview(&webview) {
        Ok(()) => IpcResponse::ok_empty(),
        Err(e) => IpcResponse::err(e),
    }
}

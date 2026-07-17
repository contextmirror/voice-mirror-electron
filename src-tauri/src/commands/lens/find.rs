//! Find on page commands.

use tauri::{AppHandle, Manager};

use super::super::IpcResponse;
use super::LensState;

/// Build the combined find + count script. `window.find()` highlights and moves
/// to a match but gives no counts, so we ALSO count occurrences JS-side (a
/// case-insensitive scan of the rendered `innerText`) and return `{found,
/// total}`. The count is approximate for matches that span element boundaries,
/// but matches Chrome's find-bar count for ordinary text.
fn find_js(query: &str, backwards: bool) -> String {
    let q = serde_json::to_string(query).unwrap_or_else(|_| "\"\"".into());
    format!(
        r#"(function(){{
            var q = {q};
            // window.find(query, caseSensitive, backwards, wrapAround, wholeWord, searchInFrames, showDialog)
            var found = window.find(q, false, {backwards}, true, false, true, false);
            var total = 0;
            if (q) {{
                var needle = q.toLowerCase();
                var hay = ((document.body && document.body.innerText) || '').toLowerCase();
                var i = 0;
                while (needle && (i = hay.indexOf(needle, i)) !== -1) {{ total++; i += needle.length; }}
            }}
            return {{ found: !!found, total: total }};
        }})()"#,
        q = q,
        backwards = if backwards { "true" } else { "false" }
    )
}

/// Run a find script in a tab and parse the `{found, total}` result.
fn exec_find(webview: &tauri::Webview, js: String) -> IpcResponse {
    let (tx, rx) = std::sync::mpsc::channel();

    let _ = webview.with_webview(move |platform_webview| {
        #[cfg(windows)]
        {
            use webview2_com::ExecuteScriptCompletedHandler;
            use windows_core::HSTRING;
            unsafe {
                let controller = platform_webview.controller();
                let core_webview = match controller.CoreWebView2() {
                    Ok(wv) => wv,
                    Err(e) => { let _ = tx.send(Err(format!("{:?}", e))); return; }
                };
                let handler = ExecuteScriptCompletedHandler::create(Box::new(move |hr, result| {
                    if hr.is_ok() {
                        let _ = tx.send(Ok(result));
                    } else {
                        let _ = tx.send(Err(format!("HRESULT {:?}", hr)));
                    }
                    Ok(())
                }));
                let _ = core_webview.ExecuteScript(&HSTRING::from(js.as_str()), &handler);
            }
        }
    });

    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        // ExecuteScript returns the JS return value serialized as JSON.
        Ok(Ok(result)) => {
            let parsed: serde_json::Value = serde_json::from_str(&result).unwrap_or(serde_json::Value::Null);
            let found = parsed.get("found").and_then(|v| v.as_bool()).unwrap_or(false);
            let total = parsed.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
            IpcResponse::ok(serde_json::json!({ "found": found, "total": total }))
        }
        Ok(Err(e)) => IpcResponse::err(&e),
        Err(_) => IpcResponse::err("Find timed out"),
    }
}

/// Find text on the current page using `window.find()` (Chromium non-standard API).
/// Highlights the first match and returns `{ found, total }`.
/// Wraps around (`wrapAround=true`) and searches inside frames (`searchInFrames=true`).
#[tauri::command]
pub fn lens_find_on_page(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        exec_find(&webview, find_js(&query, false))
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Execute JavaScript in a browser tab's child WebView2 (fire-and-forget).
#[tauri::command]
pub fn lens_eval_tab_js(
    app: AppHandle,
    tab_id: String,
    js: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        match webview.eval(&js) {
            Ok(()) => IpcResponse::ok_empty(),
            Err(e) => IpcResponse::err(&format!("{:?}", e)),
        }
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Find the next occurrence of the last searched query (forward).
/// Returns `{ found, total }`.
#[tauri::command]
pub fn lens_find_next(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        exec_find(&webview, find_js(&query, false))
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Find the previous occurrence (backwards=true). Returns `{ found, total }`.
#[tauri::command]
pub fn lens_find_previous(
    app: AppHandle,
    tab_id: String,
    query: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        exec_find(&webview, find_js(&query, true))
    } else {
        IpcResponse::err("Webview not found")
    }
}

/// Clear the find selection (remove all highlighted matches).
#[tauri::command]
pub fn lens_close_find(
    app: AppHandle,
    tab_id: String,
    state: tauri::State<'_, LensState>,
) -> IpcResponse {
    let tabs = match state.tabs.lock() {
        Ok(g) => g,
        Err(e) => return IpcResponse::err(format!("tabs mutex poisoned: {e}")),
    };
    let tab = match tabs.get(&tab_id) {
        Some(t) => t,
        None => return IpcResponse::err("Tab not found"),
    };
    let label = tab.webview_label.clone();
    drop(tabs);

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.eval("window.getSelection().removeAllRanges()");
        IpcResponse::ok_empty()
    } else {
        IpcResponse::err("Webview not found")
    }
}

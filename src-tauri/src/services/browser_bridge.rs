//! Browser bridge: processes MCP BrowserRequest messages using the native
//! Tauri webview (Lens).
//!
//! For actions that need return values from JavaScript (snapshot, act, cookies,
//! storage), we use a custom URI scheme (`lens-bridge`) pattern:
//! 1. Generate a unique eval ID
//! 2. Register a oneshot channel for that ID in BridgeState
//! 3. Inject JS that does `fetch('https://lens-bridge.localhost/result/{id}', { method: 'POST', body: result })`
//! 4. The URI scheme handler receives the result and routes it to the channel
//! 5. The caller awaits the channel with a timeout

use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex};

use crate::commands::lens::LensState;

// ---------------------------------------------------------------------------
// Bridge state for JS eval results
// ---------------------------------------------------------------------------

/// Managed state for routing JS evaluation results from the `lens-bridge`
/// URI scheme handler back to waiting callers.
pub struct BridgeState {
    /// Pending eval requests waiting for results.
    pub waiters: Mutex<HashMap<String, oneshot::Sender<String>>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            waiters: Mutex::new(HashMap::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// JS eval with result (via URI scheme bridge)
// ---------------------------------------------------------------------------

/// Counter for generating unique eval IDs.
static EVAL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn generate_eval_id() -> String {
    let n = EVAL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("eval-{}-{}", ts, n)
}

/// Evaluate JavaScript in the lens webview and return the result.
///
/// Wraps the JS expression in a fetch() call to the `lens-bridge` URI scheme,
/// which routes the result back to this function via a oneshot channel.
async fn evaluate_js_with_result(
    app: &AppHandle,
    webview: &tauri::Webview,
    js_expression: &str,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    let bridge_state = app.try_state::<BridgeState>()
        .ok_or("BridgeState not initialized")?;

    let eval_id = generate_eval_id();

    // Register a waiter
    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut waiters = bridge_state.waiters.lock().await;
        waiters.insert(eval_id.clone(), tx);
    }

    // Build the bridge URL (Windows uses https:// scheme)
    let bridge_url = if cfg!(target_os = "windows") {
        format!("https://lens-bridge.localhost/result/{}", eval_id)
    } else {
        format!("lens-bridge://localhost/result/{}", eval_id)
    };

    // Wrap the user's JS in a self-invoking async function that sends the
    // result back via fetch() to our custom URI scheme.
    let wrapped_js = format!(
        r#"(async function() {{
            try {{
                var __result = (function() {{ {js_code} }})();
                if (__result && typeof __result.then === 'function') {{
                    __result = await __result;
                }}
                var __body = (typeof __result === 'string') ? __result : JSON.stringify(__result);
                await fetch('{url}', {{ method: 'POST', body: __body, mode: 'no-cors' }});
            }} catch(__e) {{
                await fetch('{url}', {{ method: 'POST', body: JSON.stringify({{ error: __e.message }}), mode: 'no-cors' }});
            }}
        }})();"#,
        js_code = js_expression,
        url = bridge_url,
    );

    // Inject the script
    webview
        .eval(&wrapped_js)
        .map_err(|e| format!("JS eval failed: {}", e))?;

    // Wait for the result with timeout
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(result_str)) => {
            // Try to parse as JSON
            serde_json::from_str(&result_str).or_else(|_| Ok(json!({ "raw": result_str })))
        }
        Ok(Err(_)) => Err("JS eval channel closed unexpectedly".into()),
        Err(_) => {
            // Clean up the waiter
            let mut waiters = bridge_state.waiters.lock().await;
            waiters.remove(&eval_id);
            Err("JS eval timed out".into())
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: get active webview
// ---------------------------------------------------------------------------

fn get_webview(
    app: &AppHandle,
    state: &tauri::State<'_, LensState>,
) -> Result<tauri::Webview, String> {
    let label = state
        .webview_label
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or("No browser webview active. Open the Lens tab first.")?;
    app.get_webview(&label)
        .ok_or_else(|| "Lens webview not found".into())
}

/// Escape a string for safe inclusion in JavaScript single-quoted strings.
fn escape_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

// ---------------------------------------------------------------------------
// Snapshot JS
// ---------------------------------------------------------------------------

const SNAPSHOT_JS: &str = r#"
(function() {
    function buildTree(el, depth) {
        if (depth > 10) return null;
        var tag = (el.tagName || '').toLowerCase();
        var role = (el.getAttribute && el.getAttribute('role')) || '';
        var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        var text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
            ? (el.childNodes[0].textContent || '').trim().slice(0, 100) : '';
        var interactive = ['a','button','input','select','textarea'].indexOf(tag) >= 0
            || role === 'button' || role === 'link';
        var node = { tag: tag };
        if (role) node.role = role;
        if (aria) node.label = aria;
        if (text) node.text = text;
        if (el.id) node.id = el.id;
        if (interactive) {
            node.interactive = true;
            if (el.href) node.href = el.href;
            if (el.type) node.type = el.type;
            if (el.value !== undefined && el.value !== '') node.value = el.value;
            if (el.placeholder) node.placeholder = el.placeholder;
        }
        var children = [];
        var kids = el.children || [];
        for (var i = 0; i < kids.length; i++) {
            var c = buildTree(kids[i], depth + 1);
            if (c) children.push(c);
        }
        if (children.length) node.children = children;
        if (!interactive && !text && !aria && !children.length) return null;
        return node;
    }
    var tree = buildTree(document.body, 0);
    return JSON.stringify({
        title: document.title,
        url: location.href,
        tree: tree
    });
})()
"#;

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/// Process a browser action and return the result.
pub async fn handle_browser_action(
    app: &AppHandle,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    let state = app.state::<LensState>();

    match action {
        "navigate" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("URL is required")?;
            let webview = get_webview(app, &state)?;
            let parsed = url
                .parse::<tauri::Url>()
                .map_err(|e| format!("Invalid URL: {}", e))?;
            webview
                .navigate(parsed)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            Ok(json!({ "ok": true, "url": url }))
        }

        "open" => {
            // Same as navigate for single-webview model
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("URL is required")?;
            let webview = get_webview(app, &state)?;
            let parsed = url
                .parse::<tauri::Url>()
                .map_err(|e| format!("Invalid URL: {}", e))?;
            webview
                .navigate(parsed)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            Ok(json!({ "ok": true, "url": url }))
        }

        "status" => {
            let has_webview = state
                .webview_label
                .lock()
                .map(|g| g.is_some())
                .unwrap_or(false);
            let bounds = state.bounds.lock().ok().and_then(|g| *g);
            Ok(json!({
                "active": has_webview,
                "bounds": bounds.map(|(x,y,w,h)| json!({"x":x,"y":y,"width":w,"height":h})),
            }))
        }

        "tabs" => {
            let label = state
                .webview_label
                .lock()
                .map(|g| g.clone())
                .unwrap_or(None);
            match label {
                Some(l) => Ok(json!([{ "targetId": l, "type": "page", "active": true }])),
                None => Ok(json!([])),
            }
        }

        "screenshot" => {
            // WebView2 doesn't expose a direct screenshot API through Tauri 2.
            // Return page metadata and suggest using capture_screen command instead.
            let webview = get_webview(app, &state)?;
            let result = evaluate_js_with_result(
                app,
                &webview,
                r#"return JSON.stringify({
                    title: document.title,
                    url: location.href,
                    width: window.innerWidth,
                    height: window.innerHeight
                });"#,
                std::time::Duration::from_secs(10),
            )
            .await?;
            Ok(json!({
                "note": "For full screenshot, use capture_screen tool and crop to webview bounds",
                "page": result,
            }))
        }

        "snapshot" => {
            let webview = get_webview(app, &state)?;
            evaluate_js_with_result(
                app,
                &webview,
                SNAPSHOT_JS,
                std::time::Duration::from_secs(30),
            )
            .await
        }

        "act" => {
            let request = args.get("request").ok_or("request object is required")?;
            let kind = request
                .get("kind")
                .and_then(|v| v.as_str())
                .ok_or("request.kind is required")?;

            let webview = get_webview(app, &state)?;

            let js = match kind {
                "click" => {
                    let selector = request
                        .get("selector")
                        .or_else(|| request.get("ref"))
                        .and_then(|v| v.as_str())
                        .ok_or("selector or ref required for click")?;
                    format!(
                        r#"return (function() {{
                            var el = document.querySelector('{}');
                            if (!el) return JSON.stringify({{ error: 'Element not found: {}' }});
                            el.click();
                            return JSON.stringify({{ ok: true, action: 'click', selector: '{}' }});
                        }})();"#,
                        escape_js(selector),
                        escape_js(selector),
                        escape_js(selector)
                    )
                }
                "fill" | "type" => {
                    let selector = request
                        .get("selector")
                        .or_else(|| request.get("ref"))
                        .and_then(|v| v.as_str())
                        .ok_or("selector or ref required for fill")?;
                    let text = request
                        .get("text")
                        .or_else(|| request.get("value"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    format!(
                        r#"return (function() {{
                            var el = document.querySelector('{}');
                            if (!el) return JSON.stringify({{ error: 'Element not found: {}' }});
                            el.focus();
                            el.value = '{}';
                            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            return JSON.stringify({{ ok: true, action: 'fill', selector: '{}' }});
                        }})();"#,
                        escape_js(selector),
                        escape_js(selector),
                        escape_js(text),
                        escape_js(selector)
                    )
                }
                "key" | "press" => {
                    let key = request
                        .get("key")
                        .and_then(|v| v.as_str())
                        .ok_or("key is required for press")?;
                    format!(
                        r#"return (function() {{
                            document.activeElement.dispatchEvent(
                                new KeyboardEvent('keydown', {{ key: '{}', bubbles: true }})
                            );
                            document.activeElement.dispatchEvent(
                                new KeyboardEvent('keyup', {{ key: '{}', bubbles: true }})
                            );
                            return JSON.stringify({{ ok: true, action: 'press', key: '{}' }});
                        }})();"#,
                        escape_js(key),
                        escape_js(key),
                        escape_js(key)
                    )
                }
                "evaluate" | "javascript" => {
                    let expression = request
                        .get("expression")
                        .and_then(|v| v.as_str())
                        .ok_or("expression is required for evaluate")?;
                    format!(
                        r#"return (function() {{
                            try {{
                                var result = eval({});
                                return JSON.stringify({{ ok: true, result: result }});
                            }} catch(e) {{
                                return JSON.stringify({{ error: e.message }});
                            }}
                        }})();"#,
                        serde_json::to_string(expression).unwrap_or_default()
                    )
                }
                "scroll" => {
                    let x = request.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let y = request.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    format!(
                        r#"return (function() {{
                            window.scrollBy({}, {});
                            return JSON.stringify({{ ok: true, action: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY }});
                        }})();"#,
                        x, y
                    )
                }
                other => {
                    return Err(format!("Unknown action kind: {}", other));
                }
            };

            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(30),
            )
            .await
        }

        "console" => {
            Err(
                "Console capture requires initialization script injection at webview creation. \
                 This feature is not yet implemented."
                    .into(),
            )
        }

        "go_back" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.back()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "go_forward" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("history.forward()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "reload" => {
            let webview = get_webview(app, &state)?;
            webview
                .eval("location.reload()")
                .map_err(|e| format!("Failed: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        "close_tab" | "focus" => {
            // Single-tab model -- these are no-ops
            Ok(json!({ "ok": true, "note": "Single-tab browser model" }))
        }

        "cookies" => {
            let webview = get_webview(app, &state)?;
            let action_type = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("list");
            let js = match action_type {
                "list" => "return JSON.stringify({ cookies: document.cookie });".to_string(),
                "clear" => {
                    "document.cookie.split(';').forEach(function(c) { \
                     document.cookie = c.trim().split('=')[0] + \
                     '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); \
                     return JSON.stringify({ ok: true });"
                        .to_string()
                }
                _ => format!(
                    "return JSON.stringify({{ error: 'Cookie action {} not supported via JS' }});",
                    action_type
                ),
            };
            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(10),
            )
            .await
        }

        "storage" => {
            let webview = get_webview(app, &state)?;
            let raw_type = args
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("localStorage");
            // Whitelist storage types to prevent JS injection
            let storage_type = match raw_type {
                "localStorage" | "sessionStorage" => raw_type,
                _ => return Err(format!("Invalid storage type: '{}'. Must be 'localStorage' or 'sessionStorage'.", raw_type)),
            };
            let action_type = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("get");
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");

            let js = match action_type {
                "get" => format!(
                    "return JSON.stringify({{ value: {}.getItem('{}') }});",
                    storage_type,
                    escape_js(key)
                ),
                "set" => format!(
                    "{}.setItem('{}', '{}'); return JSON.stringify({{ ok: true }});",
                    storage_type,
                    escape_js(key),
                    escape_js(value)
                ),
                "delete" => format!(
                    "{}.removeItem('{}'); return JSON.stringify({{ ok: true }});",
                    storage_type,
                    escape_js(key)
                ),
                "clear" => format!(
                    "{}.clear(); return JSON.stringify({{ ok: true }});",
                    storage_type
                ),
                _ => format!(
                    "return JSON.stringify({{ error: 'Unknown action: {}' }});",
                    action_type
                ),
            };
            evaluate_js_with_result(
                app,
                &webview,
                &js,
                std::time::Duration::from_secs(10),
            )
            .await
        }

        _ => Err(format!("Unknown browser action: {}", action)),
    }
}

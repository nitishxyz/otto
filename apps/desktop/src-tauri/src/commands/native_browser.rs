use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBrowserNavigationEvent {
    id: String,
    url: String,
    loading: bool,
}

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '/' | ':' | '_' => ch,
            _ => '_',
        })
        .collect()
}

/// Browser tab webviews are labelled per owner window so two windows can host
/// the same tab id (for example `browser:browser`) without colliding in the
/// app-wide webview label registry.
fn label_prefix_for_browser_tab(window_label: &str, id: &str) -> String {
    format!("browser_{}__{}__", safe_id(window_label), safe_id(id))
}

fn label_for_browser_tab(window_label: &str, id: &str) -> String {
    format!("{}view", label_prefix_for_browser_tab(window_label, id))
}

fn browser_tab_webview(window: &tauri::Window, id: &str) -> Option<tauri::Webview> {
    let label = label_for_browser_tab(window.label(), id);
    window.get_webview(&label)
}

fn close_browser_tab_webviews(window: &tauri::Window, id: &str, except_label: Option<&str>) {
    let prefix = label_prefix_for_browser_tab(window.label(), id);
    for webview in window.webviews() {
        let label = webview.label();
        if label.starts_with(&prefix) && Some(label) != except_label {
            let _ = webview.close();
        }
    }
}

fn apply_webview_layout(
    webview: &tauri::Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|error| error.to_string())?;
    if visible {
        webview.show().map_err(|error| error.to_string())
    } else {
        webview.hide().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn native_browser_mount(
    window: tauri::Window,
    id: String,
    url: String,
    reload_key: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let _ = reload_key;
    let label = label_for_browser_tab(window.label(), &id);
    if let Some(existing) = window.get_webview(&label) {
        close_browser_tab_webviews(&window, &id, Some(&label));
        apply_webview_layout(&existing, x, y, width, height, visible)?;
        return Ok(());
    }

    close_browser_tab_webviews(&window, &id, None);

    let parsed_url = url::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err("native browser only supports http and https URLs".to_string());
    }
    let event_window = window.clone();
    let event_target = window.label().to_string();
    let event_id = id.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .zoom_hotkeys_enabled(true)
        .on_page_load(move |_webview, payload| {
            let _ = event_window.emit_to(
                event_target.as_str(),
                "native-browser-navigation",
                NativeBrowserNavigationEvent {
                    id: event_id.clone(),
                    url: payload.url().to_string(),
                    loading: payload.event() == PageLoadEvent::Started,
                },
            );
        });
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x.max(0.0), y.max(0.0)),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|error| error.to_string())?;

    apply_webview_layout(&webview, x, y, width, height, visible)
}

#[tauri::command]
pub async fn native_browser_set_visible(
    window: tauri::Window,
    id: String,
    visible: bool,
) -> Result<(), String> {
    let prefix = label_prefix_for_browser_tab(window.label(), &id);
    for webview in window.webviews() {
        if webview.label().starts_with(&prefix) {
            if visible {
                webview.show().map_err(|error| error.to_string())?;
            } else {
                webview.hide().map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn native_browser_unmount(window: tauri::Window, id: String) -> Result<(), String> {
    close_browser_tab_webviews(&window, &id, None);
    Ok(())
}

#[tauri::command]
pub async fn native_browser_control(
    window: tauri::Window,
    id: String,
    action: String,
    url: Option<String>,
) -> Result<(), String> {
    let webview = browser_tab_webview(&window, &id)
        .ok_or_else(|| format!("browser tab is not mounted: {id}"))?;
    match action.as_str() {
        "navigate" => {
            let value = url.ok_or_else(|| "navigate requires a URL".to_string())?;
            let parsed = url::Url::parse(&value).map_err(|error| error.to_string())?;
            if parsed.scheme() != "http" && parsed.scheme() != "https" {
                return Err("native browser only supports http and https URLs".to_string());
            }
            webview.navigate(parsed).map_err(|error| error.to_string())
        }
        "back" => webview
            .eval("history.back()")
            .map_err(|error| error.to_string()),
        "forward" => webview
            .eval("history.forward()")
            .map_err(|error| error.to_string()),
        "reload" => webview.reload().map_err(|error| error.to_string()),
        "stop" => webview
            .eval("window.stop()")
            .map_err(|error| error.to_string()),
        _ => Err(format!("unsupported native browser action: {action}")),
    }
}

#[tauri::command]
pub async fn native_browser_execute(
    window: tauri::Window,
    id: String,
    script: String,
) -> Result<serde_json::Value, String> {
    const MAX_SCRIPT_BYTES: usize = 256 * 1024;
    if script.len() > MAX_SCRIPT_BYTES {
        return Err("browser script exceeds the 256 KiB limit".to_string());
    }

    let webview = browser_tab_webview(&window, &id)
        .ok_or_else(|| format!("browser tab is not mounted: {id}"))?;
    let (sender, receiver) = tokio::sync::oneshot::channel::<String>();
    let sender = Mutex::new(Some(sender));

    webview
        .eval_with_callback(script, move |value| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|error| error.to_string())?;

    let raw = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "browser script timed out".to_string())?
        .map_err(|_| "browser script result channel closed".to_string())?;
    if raw.len() > 1024 * 1024 {
        return Err("browser script result exceeds the 1 MiB limit".to_string());
    }
    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw)))
}

#[cfg(test)]
mod tests {
    use super::{label_for_browser_tab, label_prefix_for_browser_tab};

    #[test]
    fn browser_tab_prefixes_do_not_overlap() {
        let main_prefix = label_prefix_for_browser_tab("main", "browser:browser");
        let secondary = label_for_browser_tab("main", "browser:browser:secondary");
        assert!(!secondary.starts_with(&main_prefix));
    }

    #[test]
    fn browser_tab_label_is_stable_across_navigation() {
        assert_eq!(
            label_for_browser_tab("main", "browser:browser"),
            label_for_browser_tab("main", "browser:browser")
        );
    }

    #[test]
    fn browser_tab_labels_are_scoped_to_the_owner_window() {
        assert_ne!(
            label_for_browser_tab("main", "browser:browser"),
            label_for_browser_tab("main-1", "browser:browser")
        );
        let main_prefix = label_prefix_for_browser_tab("main", "browser:browser");
        let other = label_for_browser_tab("main-1", "browser:browser");
        assert!(!other.starts_with(&main_prefix));
    }
}

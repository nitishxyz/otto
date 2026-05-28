use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '/' | ':' | '_' => ch,
            _ => '_',
        })
        .collect()
}

fn label_prefix_for_browser_tab(id: &str) -> String {
    format!("browser_{}", safe_id(id))
}

fn label_for_browser_tab(id: &str, url: &str, reload_key: u32) -> String {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let url_hash = hasher.finish();
    format!(
        "{}_{}_{}",
        label_prefix_for_browser_tab(id),
        reload_key,
        url_hash
    )
}

fn close_browser_tab_webviews(window: &tauri::Window, id: &str, except_label: Option<&str>) {
    let prefix = label_prefix_for_browser_tab(id);
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
    let label = label_for_browser_tab(&id, &url, reload_key);
    if let Some(existing) = window.get_webview(&label) {
        close_browser_tab_webviews(&window, &id, Some(&label));
        apply_webview_layout(&existing, x, y, width, height, visible)?;
        return Ok(());
    }

    close_browser_tab_webviews(&window, &id, None);

    let parsed_url = url::Url::parse(&url).map_err(|error| error.to_string())?;
    let builder =
        WebviewBuilder::new(label, WebviewUrl::External(parsed_url)).zoom_hotkeys_enabled(true);
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
    let prefix = label_prefix_for_browser_tab(&id);
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

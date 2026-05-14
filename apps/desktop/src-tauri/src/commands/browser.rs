use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

fn browser_label(tab_id: &str) -> String {
    let safe_id: String = tab_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    format!("browser-{safe_id}")
}

fn parse_url(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|error| format!("Invalid browser URL {url}: {error}"))
}

fn js_string(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_open_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = browser_label(&tab_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        let script = format!("window.location.href = {};", js_string(&url)?);
        window.eval(&script).map_err(|error| error.to_string())?;
        return Ok(());
    }

    let parsed_url = parse_url(&url)?;
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title(title.as_deref().unwrap_or("Otto Browser"))
        .inner_size(1100.0, 760.0)
        .min_inner_size(420.0, 320.0)
        .resizable(true)
        .decorations(true)
        .disable_drag_drop_handler()
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn browser_navigate_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let label = browser_label(&tab_id);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Browser tab {tab_id} is not open"))?;
    let script = format!("window.location.href = {};", js_string(&url)?);
    window.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_reload_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = browser_label(&tab_id);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Browser tab {tab_id} is not open"))?;
    window
        .eval("window.location.reload();")
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_close_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = browser_label(&tab_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_eval_tab(
    app: AppHandle,
    tab_id: String,
    script: String,
) -> Result<(), String> {
    let label = browser_label(&tab_id);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Browser tab {tab_id} is not open"))?;
    window.eval(&script).map_err(|error| error.to_string())
}

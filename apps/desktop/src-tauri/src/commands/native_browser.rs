use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{
    DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder, WebviewWindowBuilder,
};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Screenshots re-render the page, so they only need a modest budget.
const SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(15);
static POPUP_RELAY_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBrowserNavigationEvent {
    id: String,
    url: String,
    loading: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBrowserNewTabEvent {
    id: String,
    url: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBrowserDownloadEvent {
    id: String,
    url: String,
    status: &'static str,
    path: Option<String>,
    success: Option<bool>,
}

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '/' | ':' | '_' => ch,
            _ => '_',
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn safari_major_for_macos(macos_major: isize) -> isize {
    match macos_major {
        26.. => macos_major,
        15 => 18,
        14 => 17,
        13 => 16,
        12 => 15,
        11 => 14,
        _ => 13,
    }
}

#[cfg(target_os = "macos")]
fn macos_browser_user_agent() -> String {
    use objc2_foundation::NSProcessInfo;

    let macos_major = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;
    let safari_major = safari_major_for_macos(macos_major);
    format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{safari_major}.0 Safari/605.1.15"
    )
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

#[cfg(target_os = "macos")]
fn remove_initialization_scripts(webview: &tauri::Webview) -> Result<(), String> {
    use objc2_web_kit::WKWebView;

    webview
        .with_webview(|platform| {
            let handle = platform.inner();
            if handle.is_null() {
                return;
            }
            // SAFETY: Tauri runs this closure on the main thread and the handle is
            // the live WKWebView backing this browser tab.
            unsafe {
                let view: &WKWebView = &*(handle as *mut WKWebView);
                view.configuration()
                    .userContentController()
                    .removeAllUserScripts();
            }
        })
        .map_err(|error| error.to_string())
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
#[allow(clippy::too_many_arguments)]
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
    let new_tab_window = window.clone();
    let new_tab_target = window.label().to_string();
    let new_tab_id = id.clone();
    let popup_app = window.app_handle().clone();
    let download_window = window.clone();
    let download_target = window.label().to_string();
    let download_id = id.clone();
    #[cfg(target_os = "macos")]
    let initial_url = WebviewUrl::External(url::Url::parse("about:blank").unwrap());
    #[cfg(not(target_os = "macos"))]
    let initial_url = WebviewUrl::External(parsed_url.clone());
    let mut builder = WebviewBuilder::new(label, initial_url);
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .data_store_identifier(*b"otto-browser-v2!")
            .user_agent(&macos_browser_user_agent());
    }
    let builder = builder
        .zoom_hotkeys_enabled(true)
        .on_new_window(move |url, features| {
            if url.scheme() == "http" || url.scheme() == "https" {
                let _ = new_tab_window.emit_to(
                    new_tab_target.as_str(),
                    "native-browser-new-tab",
                    NativeBrowserNewTabEvent {
                        id: new_tab_id.clone(),
                        url: url.to_string(),
                    },
                );
                return NewWindowResponse::Deny;
            }

            if url.scheme() != "about" {
                return NewWindowResponse::Deny;
            }

            // Some sites open about:blank and assign the destination through
            // the returned window handle. Keep that popup hidden just long
            // enough to observe its first real navigation, then turn it into
            // an Otto browser tab.
            let relay_window = new_tab_window.clone();
            let relay_target = new_tab_target.clone();
            let relay_id = new_tab_id.clone();
            let relay_label = format!(
                "browser_popup_relay_{}",
                POPUP_RELAY_ID.fetch_add(1, Ordering::Relaxed)
            );
            let relay = WebviewWindowBuilder::new(
                &popup_app,
                relay_label,
                WebviewUrl::External(url.clone()),
            )
            .window_features(features)
            .visible(false)
            .skip_taskbar(true)
            .on_page_load(move |popup, payload| {
                let destination = payload.url();
                if destination.scheme() != "http" && destination.scheme() != "https" {
                    return;
                }
                let _ = relay_window.emit_to(
                    relay_target.as_str(),
                    "native-browser-new-tab",
                    NativeBrowserNewTabEvent {
                        id: relay_id.clone(),
                        url: destination.to_string(),
                    },
                );
                let _ = popup.close();
            })
            .build();

            match relay {
                Ok(window) => {
                    let stale_relay = window.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(15)).await;
                        let _ = stale_relay.close();
                    });
                    NewWindowResponse::Create { window }
                }
                Err(_) => NewWindowResponse::Deny,
            }
        })
        .on_download(move |_webview, event| {
            let payload = match event {
                DownloadEvent::Requested { url, destination } => NativeBrowserDownloadEvent {
                    id: download_id.clone(),
                    url: url.to_string(),
                    status: "requested",
                    path: Some(destination.to_string_lossy().into_owned()),
                    success: None,
                },
                DownloadEvent::Finished { url, path, success } => NativeBrowserDownloadEvent {
                    id: download_id.clone(),
                    url: url.to_string(),
                    status: "finished",
                    path: path.map(|value| value.to_string_lossy().into_owned()),
                    success: Some(success),
                },
                _ => return true,
            };
            let _ = download_window.emit_to(
                download_target.as_str(),
                "native-browser-download",
                payload,
            );
            true
        })
        .on_page_load(move |_webview, payload| {
            if payload.url().scheme() == "about" {
                return;
            }
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

    #[cfg(target_os = "macos")]
    {
        remove_initialization_scripts(&webview)?;
        webview
            .navigate(parsed_url)
            .map_err(|error| error.to_string())?;
    }

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

/// Captures the rendered contents of a mounted browser tab as base64 PNG bytes.
///
/// The tab must be mounted and visible: the platform webview renders the
/// snapshot from the live view hierarchy.
#[tauri::command]
pub async fn native_browser_screenshot(
    window: tauri::Window,
    id: String,
) -> Result<String, String> {
    let webview = browser_tab_webview(&window, &id)
        .ok_or_else(|| format!("browser tab is not mounted: {id}"))?;
    let png = capture_webview_png(&webview)?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        png,
    ))
}

#[cfg(target_os = "macos")]
fn capture_webview_png(webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    let (sender, receiver) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
    webview
        .with_webview(move |platform| {
            let handle = platform.inner();
            if handle.is_null() {
                let _ = sender.send(Err("native webview handle is unavailable".to_string()));
                return;
            }
            // SAFETY: Tauri runs this closure on the main thread and the handle
            // is the live WKWebView backing this tab.
            unsafe {
                let view: &WKWebView = &*(handle as *mut WKWebView);
                let configuration = WKSnapshotConfiguration::new(MainThreadMarker::new_unchecked());
                configuration.setAfterScreenUpdates(true);
                let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                    let _ = sender.send(encode_snapshot_png(image, error));
                });
                view.takeSnapshotWithConfiguration_completionHandler(
                    Some(&configuration),
                    &handler,
                );
            }
        })
        .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(SCREENSHOT_TIMEOUT)
        .map_err(|_| "browser screenshot timed out".to_string())?
}

#[cfg(target_os = "macos")]
unsafe fn encode_snapshot_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    if !error.is_null() {
        return Err((*error).localizedDescription().to_string());
    }
    if image.is_null() {
        return Err("the browser tab returned an empty snapshot".to_string());
    }

    let tiff = (*image)
        .TIFFRepresentation()
        .ok_or_else(|| "the browser snapshot could not be read".to_string())?;
    let representation = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "the browser snapshot could not be decoded".to_string())?;
    let png = representation
        .representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        .ok_or_else(|| "the browser snapshot could not be encoded as PNG".to_string())?;
    Ok(png.to_vec())
}

#[cfg(not(target_os = "macos"))]
fn capture_webview_png(_webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    Err("browser screenshots are only supported on macOS today".to_string())
}

#[cfg(test)]
mod tests {
    use super::{label_for_browser_tab, label_prefix_for_browser_tab};

    #[cfg(target_os = "macos")]
    use super::{macos_browser_user_agent, safari_major_for_macos};

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_browser_identifies_as_the_matching_safari_generation() {
        assert_eq!(safari_major_for_macos(15), 18);
        assert_eq!(safari_major_for_macos(26), 26);

        let user_agent = macos_browser_user_agent();
        assert!(user_agent.contains("AppleWebKit/605.1.15"));
        assert!(user_agent.contains("Version/"));
        assert!(user_agent.ends_with("Safari/605.1.15"));
    }

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

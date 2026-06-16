use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotificationPayload {
    title: String,
    body: Option<String>,
    session_id: Option<String>,
    window_label: Option<String>,
}

fn open_session_window(app: &AppHandle, window_label: Option<String>, session_id: Option<String>) {
    let label = window_label.unwrap_or_else(|| "main".to_string());
    let Some(window) = app.get_webview_window(&label) else {
        return;
    };

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    if let Some(session_id) = session_id {
        let _ = window.emit("otto-open-session", session_id);
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn show_native_notification(
    app: AppHandle,
    notification: NativeNotificationPayload,
) -> Result<(), String> {
    let app_for_click = app.clone();
    std::thread::spawn(move || {
        let identifier = if tauri::is_dev() {
            "com.apple.Terminal".to_string()
        } else {
            app_for_click.config().identifier.clone()
        };
        let _ = mac_notification_sys::set_application(&identifier);

        let mut mac_notification = mac_notification_sys::Notification::new();
        mac_notification
            .title(&notification.title)
            .message(notification.body.as_deref().unwrap_or(""));

        if notification.session_id.is_some() {
            mac_notification.wait_for_click(true);
        }

        let response = mac_notification.send();
        if matches!(
            response,
            Ok(mac_notification_sys::NotificationResponse::Click)
        ) {
            open_session_window(
                &app_for_click,
                notification.window_label,
                notification.session_id,
            );
        }
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn show_native_notification(
    app: AppHandle,
    notification: NativeNotificationPayload,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(notification.title)
        .body(notification.body.unwrap_or_default())
        .show()
        .map_err(|error| error.to_string())
}

use serde::Deserialize;
#[cfg(target_os = "macos")]
use std::io::{Read, Write};
#[cfg(target_os = "macos")]
use std::net::{TcpListener, TcpStream};
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotificationPayload {
    title: String,
    body: Option<String>,
    session_id: Option<String>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq, Eq)]
struct NotificationTarget {
    window_label: String,
    session_id: Option<String>,
}

#[cfg(target_os = "macos")]
fn notification_target(window_label: &str, session_id: Option<String>) -> NotificationTarget {
    NotificationTarget {
        window_label: window_label.to_string(),
        session_id,
    }
}

#[cfg(target_os = "macos")]
fn open_session_window(app: &AppHandle, window_label: &str, session_id: Option<String>) {
    let Some(window) = app.get_webview_window(window_label) else {
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
fn notify_click_callback(callback_url: &str) {
    let Some(rest) = callback_url.strip_prefix("http://127.0.0.1:") else {
        return;
    };
    let Some((port, path)) = rest.split_once('/') else {
        return;
    };
    let Ok(mut stream) = TcpStream::connect(format!("127.0.0.1:{port}")) else {
        return;
    };
    let request =
        format!("GET /{path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(request.as_bytes());
}

#[cfg(target_os = "macos")]
pub fn run_notification_helper(args: &[String]) -> i32 {
    if args.len() < 5 {
        return 2;
    }

    let identifier = &args[1];
    let title = &args[2];
    let body = &args[3];
    let callback_url = &args[4];

    let _ = mac_notification_sys::set_application(identifier);
    let mut notification = mac_notification_sys::Notification::new();
    notification.title(title).message(body).wait_for_click(true);

    if matches!(
        notification.send(),
        Ok(mac_notification_sys::NotificationResponse::Click)
    ) {
        notify_click_callback(callback_url);
    }

    0
}

#[cfg(target_os = "macos")]
fn spawn_click_helper(identifier: String, title: String, body: String, callback_url: String) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let _ = Command::new(exe)
        .arg("--otto-notification-helper")
        .arg(identifier)
        .arg(title)
        .arg(body)
        .arg(callback_url)
        .spawn();
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn show_native_notification(
    app: AppHandle,
    window: WebviewWindow,
    notification: NativeNotificationPayload,
) -> Result<(), String> {
    let identifier = if tauri::is_dev() {
        "com.apple.Terminal".to_string()
    } else {
        app.config().identifier.clone()
    };

    if notification.session_id.is_none() {
        let _ = mac_notification_sys::set_application(&identifier);
        let mut mac_notification = mac_notification_sys::Notification::new();
        mac_notification
            .title(&notification.title)
            .message(notification.body.as_deref().unwrap_or(""))
            .asynchronous(true);
        let _ = mac_notification.send();
        return Ok(());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string();
    let callback_url = format!("http://127.0.0.1:{port}/notification-click/{token}");
    let expected_path = format!("/notification-click/{token}");
    let app_for_click = app.clone();
    let target = notification_target(window.label(), notification.session_id.clone());

    std::thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        let started = SystemTime::now();
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut buffer = [0_u8; 1024];
                    let Ok(read) = stream.read(&mut buffer) else {
                        return;
                    };
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    if request.starts_with(&format!("GET {expected_path} ")) {
                        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\n\r\n");
                        let app_for_main = app_for_click.clone();
                        let _ = app_for_click.run_on_main_thread(move || {
                            open_session_window(
                                &app_for_main,
                                &target.window_label,
                                target.session_id,
                            );
                        });
                    }
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed().unwrap_or_default() > Duration::from_secs(600) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(_) => return,
            }
        }
    });

    spawn_click_helper(
        identifier,
        notification.title,
        notification.body.unwrap_or_default(),
        callback_url,
    );

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn show_native_notification(
    app: AppHandle,
    _window: WebviewWindow,
    notification: NativeNotificationPayload,
) -> Result<(), String> {
    let _ = notification.session_id;

    app.notification()
        .builder()
        .title(notification.title)
        .body(notification.body.unwrap_or_default())
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{notification_target, NotificationTarget};

    #[test]
    fn notification_target_preserves_the_invoking_window() {
        assert_eq!(
            notification_target("main-7", Some("session-123".to_string())),
            NotificationTarget {
                window_label: "main-7".to_string(),
                session_id: Some("session-123".to_string()),
            }
        );
    }
}

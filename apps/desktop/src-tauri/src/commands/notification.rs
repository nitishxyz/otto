use serde::Deserialize;
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::io::{Read, Write};
#[cfg(target_os = "macos")]
use std::net::{TcpListener, TcpStream};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotificationPayload {
    id: String,
    title: String,
    body: Option<String>,
    session_id: Option<String>,
    active_session_id: Option<String>,
    window_focused: bool,
}

const NOTIFICATION_DEDUP_TTL: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, PartialEq, Eq)]
struct NotificationTarget {
    window_label: String,
    session_id: Option<String>,
}

struct PendingNotification {
    target: NotificationTarget,
    priority: u8,
    created_at: Instant,
}

static PENDING_NOTIFICATIONS: OnceLock<Mutex<HashMap<String, PendingNotification>>> =
    OnceLock::new();

fn pending_notifications() -> &'static Mutex<HashMap<String, PendingNotification>> {
    PENDING_NOTIFICATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn notification_target(
    window_label: &str,
    session_id: Option<String>,
    active_session_id: Option<&str>,
    window_focused: bool,
) -> (NotificationTarget, u8) {
    let owns_session = session_id
        .as_deref()
        .zip(active_session_id)
        .map(|(notification_session, active_session)| notification_session == active_session)
        .unwrap_or(false);
    (
        NotificationTarget {
            window_label: window_label.to_string(),
            session_id,
        },
        if owns_session {
            2
        } else if window_focused {
            1
        } else {
            0
        },
    )
}

fn register_notification(
    notifications: &mut HashMap<String, PendingNotification>,
    id: &str,
    target: NotificationTarget,
    priority: u8,
    now: Instant,
) -> bool {
    notifications.retain(|_, pending| {
        now.saturating_duration_since(pending.created_at) <= NOTIFICATION_DEDUP_TTL
    });

    if let Some(pending) = notifications.get_mut(id) {
        if priority > pending.priority {
            pending.target = target;
            pending.priority = priority;
        }
        return false;
    }

    notifications.insert(
        id.to_string(),
        PendingNotification {
            target,
            priority,
            created_at: now,
        },
    );
    true
}

fn take_notification_target(id: &str) -> Option<NotificationTarget> {
    pending_notifications()
        .lock()
        .ok()?
        .remove(id)
        .map(|pending| pending.target)
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
    let listener = if notification.session_id.is_some() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
        listener
            .set_nonblocking(false)
            .map_err(|error| error.to_string())?;
        Some(listener)
    } else {
        None
    };
    let (target, priority) = notification_target(
        window.label(),
        notification.session_id.clone(),
        notification.active_session_id.as_deref(),
        notification.window_focused,
    );
    let is_new = {
        let mut notifications = pending_notifications()
            .lock()
            .map_err(|error| error.to_string())?;
        register_notification(
            &mut notifications,
            &notification.id,
            target,
            priority,
            Instant::now(),
        )
    };
    if !is_new {
        return Ok(());
    }

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

    let listener = listener.expect("session notifications create a click listener");
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
    let notification_id = notification.id.clone();

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
                        if let Some(target) = take_notification_target(&notification_id) {
                            let app_for_main = app_for_click.clone();
                            let _ = app_for_click.run_on_main_thread(move || {
                                open_session_window(
                                    &app_for_main,
                                    &target.window_label,
                                    target.session_id,
                                );
                            });
                        }
                    }
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed().unwrap_or_default() > NOTIFICATION_DEDUP_TTL {
                        let _ = take_notification_target(&notification_id);
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
    window: WebviewWindow,
    notification: NativeNotificationPayload,
) -> Result<(), String> {
    let (target, priority) = notification_target(
        window.label(),
        notification.session_id.clone(),
        notification.active_session_id.as_deref(),
        notification.window_focused,
    );
    let is_new = {
        let mut notifications = pending_notifications()
            .lock()
            .map_err(|error| error.to_string())?;
        register_notification(
            &mut notifications,
            &notification.id,
            target,
            priority,
            Instant::now(),
        )
    };
    if !is_new {
        return Ok(());
    }

    app.notification()
        .builder()
        .title(notification.title)
        .body(notification.body.unwrap_or_default())
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        notification_target, register_notification, NotificationTarget, PendingNotification,
    };
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    #[test]
    fn notification_target_prefers_the_window_showing_the_session() {
        let (target, priority) = notification_target(
            "main-7",
            Some("session-123".to_string()),
            Some("session-123"),
            false,
        );
        assert_eq!(
            target,
            NotificationTarget {
                window_label: "main-7".to_string(),
                session_id: Some("session-123".to_string()),
            }
        );
        assert_eq!(priority, 2);
    }

    #[test]
    fn duplicate_notification_updates_target_without_spawning_again() {
        let now = Instant::now();
        let mut notifications: HashMap<String, PendingNotification> = HashMap::new();
        let (fallback, fallback_priority) = notification_target(
            "main-1",
            Some("session-123".to_string()),
            Some("session-other"),
            true,
        );
        let (owner, owner_priority) = notification_target(
            "main-2",
            Some("session-123".to_string()),
            Some("session-123"),
            false,
        );

        assert!(register_notification(
            &mut notifications,
            "notification-1",
            fallback,
            fallback_priority,
            now,
        ));
        assert!(!register_notification(
            &mut notifications,
            "notification-1",
            owner,
            owner_priority,
            now + Duration::from_millis(10),
        ));
        assert_eq!(
            notifications
                .get("notification-1")
                .unwrap()
                .target
                .window_label,
            "main-2"
        );
    }
}

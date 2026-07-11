use super::machine::{MachineBootstrap, MachineWindowContext, MachineWindowState, TunnelDevice};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[tauri::command]
pub async fn create_new_window(app: AppHandle) -> Result<(), String> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{}", count);

    let mut window_config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing primary window config".to_string())?;
    window_config.label = label;

    let builder = WebviewWindowBuilder::from_config(&app, &window_config)
        .map_err(|e: tauri::Error| e.to_string())?;

    #[cfg(target_os = "linux")]
    let builder = builder.decorations(false);

    builder.build().map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

fn machine_window_label(device_id: &str) -> String {
    let mut hasher = DefaultHasher::new();
    device_id.hash(&mut hasher);
    format!("machine-{:016x}", hasher.finish())
}

/// Picks the window to focus for a repeated open request on `device_id`:
/// only an idle picker window (no project open) is reusable, so windows
/// that already show a project keep running and a fresh picker can open
/// alongside them. Also returns labels whose windows no longer exist so
/// the caller can prune stale state.
fn reusable_picker_label<'a>(
    entries: impl Iterator<Item = (&'a String, &'a MachineWindowContext)>,
    device_id: &str,
    window_exists: impl Fn(&str) -> bool,
) -> (Option<String>, Vec<String>) {
    let mut focus = None;
    let mut stale = Vec::new();
    for (label, context) in entries {
        if context.bootstrap.device_id != device_id {
            continue;
        }
        if !window_exists(label) {
            stale.push(label.clone());
            continue;
        }
        if context.project_id.is_none() && focus.is_none() {
            focus = Some(label.clone());
        }
    }
    (focus, stale)
}

#[tauri::command]
pub async fn open_machine_window(app: AppHandle, device: TunnelDevice) -> Result<(), String> {
    let focus_label = {
        let state = app.state::<MachineWindowState>();
        let mut windows = state.0.lock().map_err(|error| error.to_string())?;
        let (focus, stale) = reusable_picker_label(windows.iter(), &device.device_id, |label| {
            app.get_webview_window(label).is_some()
        });
        for label in stale {
            windows.remove(&label);
        }
        focus
    };
    if let Some(label) = focus_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
    }

    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("{}-{}", machine_window_label(&device.device_id), count);

    let bootstrap = MachineBootstrap {
        device_id: device.device_id,
        hostname: device.hostname,
        name: device.name,
    };
    {
        let state = app.state::<MachineWindowState>();
        let mut windows = state.0.lock().map_err(|error| error.to_string())?;
        windows.insert(
            label.clone(),
            MachineWindowContext {
                bootstrap,
                project_id: None,
            },
        );
    }

    let mut window_config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing primary window config".to_string())?;
    window_config.label = label.clone();
    let builder = WebviewWindowBuilder::from_config(&app, &window_config)
        .map_err(|error: tauri::Error| error.to_string())?;
    #[cfg(target_os = "linux")]
    let builder = builder.decorations(false);
    if let Err(error) = builder.build() {
        if let Ok(mut windows) = app.state::<MachineWindowState>().0.lock() {
            windows.remove(&label);
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{machine_window_label, reusable_picker_label};
    use crate::commands::machine::{MachineBootstrap, MachineWindowContext};
    use std::collections::HashMap;

    fn context(device_id: &str, project_id: Option<&str>) -> MachineWindowContext {
        MachineWindowContext {
            bootstrap: MachineBootstrap {
                device_id: device_id.to_string(),
                hostname: None,
                name: None,
            },
            project_id: project_id.map(|id| id.to_string()),
        }
    }

    #[test]
    fn machine_labels_are_stable_and_non_secret() {
        let first = machine_window_label("device/account:123");
        assert_eq!(first, machine_window_label("device/account:123"));
        assert!(first.starts_with("machine-"));
        assert!(!first.contains("device/account:123"));
    }

    #[test]
    fn focuses_only_idle_picker_windows_for_the_same_machine() {
        let mut entries = HashMap::new();
        entries.insert("machine-a-1".to_string(), context("device-a", Some("p1")));
        entries.insert("machine-a-2".to_string(), context("device-a", None));
        entries.insert("machine-b-3".to_string(), context("device-b", None));

        let (focus, stale) = reusable_picker_label(entries.iter(), "device-a", |_| true);
        assert_eq!(focus.as_deref(), Some("machine-a-2"));
        assert!(stale.is_empty());
    }

    #[test]
    fn opens_new_window_when_existing_windows_have_projects_open() {
        let mut entries = HashMap::new();
        entries.insert("machine-a-1".to_string(), context("device-a", Some("p1")));
        entries.insert("machine-a-2".to_string(), context("device-a", Some("p2")));

        let (focus, stale) = reusable_picker_label(entries.iter(), "device-a", |_| true);
        assert_eq!(focus, None);
        assert!(stale.is_empty());
    }

    #[test]
    fn prunes_state_for_closed_windows_instead_of_focusing_them() {
        let mut entries = HashMap::new();
        entries.insert("machine-a-1".to_string(), context("device-a", None));

        let (focus, stale) = reusable_picker_label(entries.iter(), "device-a", |_| false);
        assert_eq!(focus, None);
        assert_eq!(stale, vec!["machine-a-1".to_string()]);
    }
}

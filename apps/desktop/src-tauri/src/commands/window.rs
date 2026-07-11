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

#[tauri::command]
pub async fn open_machine_window(app: AppHandle, device: TunnelDevice) -> Result<(), String> {
    let label = machine_window_label(&device.device_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let bootstrap = MachineBootstrap {
        device_id: device.device_id,
        hostname: device.hostname,
        name: device.name,
    };
    {
        let state = app.state::<MachineWindowState>();
        let mut windows = state.0.lock().map_err(|error| error.to_string())?;
        windows.insert(label.clone(), MachineWindowContext { bootstrap });
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
    use super::machine_window_label;

    #[test]
    fn machine_labels_are_stable_and_non_secret() {
        let first = machine_window_label("device/account:123");
        assert_eq!(first, machine_window_label("device/account:123"));
        assert!(first.starts_with("machine-"));
        assert!(!first.contains("device/account:123"));
    }
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDevice {
    pub device_id: String,
    pub machine_id: String,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub local_api_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineBootstrap {
    pub device_id: String,
    pub machine_id: String,
    pub hostname: Option<String>,
    pub name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MachineWindowContext {
    pub bootstrap: MachineBootstrap,
    /// Project currently open in the window; `None` while it shows the picker.
    pub project_id: Option<String>,
}

#[derive(Default)]
pub struct MachineWindowState(pub Mutex<HashMap<String, MachineWindowContext>>);

#[tauri::command]
pub fn get_machine_bootstrap(
    window: WebviewWindow,
    state: tauri::State<'_, MachineWindowState>,
) -> Result<Option<MachineBootstrap>, String> {
    let windows = state.0.lock().map_err(|error| error.to_string())?;
    Ok(windows
        .get(window.label())
        .map(|context| context.bootstrap.clone()))
}

/// Selects a remote machine for the current window, or clears the selection
/// when returning to this computer's local projects.
#[tauri::command]
pub fn set_current_machine(
    window: WebviewWindow,
    state: tauri::State<'_, MachineWindowState>,
    device: Option<TunnelDevice>,
) -> Result<Option<MachineBootstrap>, String> {
    let mut windows = state.0.lock().map_err(|error| error.to_string())?;
    let Some(device) = device else {
        windows.remove(window.label());
        return Ok(None);
    };
    let bootstrap = MachineBootstrap {
        device_id: device.device_id,
        machine_id: device.machine_id,
        hostname: device.hostname,
        name: device.name,
    };
    windows.insert(
        window.label().to_string(),
        MachineWindowContext {
            bootstrap: bootstrap.clone(),
            project_id: None,
        },
    );
    Ok(Some(bootstrap))
}

/// Renderer reports which project its machine window has open (or `None`
/// when it returns to the project picker) so duplicate open requests can
/// reuse idle picker windows instead of focusing busy project windows.
#[tauri::command]
pub fn set_machine_window_project(
    window: WebviewWindow,
    state: tauri::State<'_, MachineWindowState>,
    project_id: Option<String>,
) -> Result<(), String> {
    let mut windows = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(context) = windows.get_mut(window.label()) {
        context.project_id = project_id;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MachineBootstrap, TunnelDevice};

    #[test]
    fn renderer_device_metadata_contains_no_credentials() {
        let device = TunnelDevice {
            device_id: "device-1".to_string(),
            machine_id: "machine-1".to_string(),
            hostname: Some("device.ottorouter.org".to_string()),
            name: Some("Studio".to_string()),
            status: Some("online".to_string()),
            local_api_url: None,
        };
        let json = serde_json::to_string(&device).unwrap();
        assert!(!json.contains("token"));
        assert!(!json.contains("secret"));
    }

    #[test]
    fn machine_bootstrap_contains_only_routing_metadata() {
        let bootstrap = MachineBootstrap {
            device_id: "device-1".to_string(),
            machine_id: "machine-1".to_string(),
            hostname: Some("device.ottorouter.org".to_string()),
            name: Some("Studio".to_string()),
        };
        let json = serde_json::to_string(&bootstrap).unwrap();
        assert!(!json.contains("token"));
        assert!(!json.contains("secret"));
    }
}

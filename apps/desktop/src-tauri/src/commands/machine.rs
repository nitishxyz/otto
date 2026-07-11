use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDevice {
    pub device_id: String,
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
    pub hostname: Option<String>,
    pub name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MachineWindowContext {
    pub bootstrap: MachineBootstrap,
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

#[cfg(test)]
mod tests {
    use super::TunnelDevice;

    #[test]
    fn renderer_device_metadata_contains_no_credentials() {
        let device = TunnelDevice {
            device_id: "device-1".to_string(),
            hostname: Some("device.ottorouter.org".to_string()),
            name: Some("Studio".to_string()),
            status: Some("online".to_string()),
            local_api_url: None,
        };
        let json = serde_json::to_string(&device).unwrap();
        assert!(!json.contains("token"));
        assert!(!json.contains("secret"));
    }
}

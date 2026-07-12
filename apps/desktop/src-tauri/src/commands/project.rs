use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

pub(crate) fn get_general_workspace_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "No data directory".to_string())?;

    Ok(base_dir.join("otto").join("general"))
}

#[tauri::command]
pub async fn open_project_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    match rx.recv() {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub path: String,
    pub name: String,
    pub last_opened: DateTime<Utc>,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
}

fn get_projects_config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "No home directory".to_string())
        .map(|p| p.join(".otto").join("desktop-projects.json"))
}

fn get_general_workspace_dir() -> Result<PathBuf, String> {
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

#[tauri::command]
pub async fn get_general_workspace_path() -> Result<String, String> {
    let workspace_dir = get_general_workspace_dir()?;

    std::fs::create_dir_all(&workspace_dir).map_err(|e| e.to_string())?;

    Ok(workspace_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_recent_projects() -> Result<Vec<Project>, String> {
    let config_path = get_projects_config_path()?;

    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;

    let mut projects: Vec<Project> = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));

    Ok(projects)
}

#[tauri::command]
pub async fn save_recent_project(project: Project) -> Result<(), String> {
    let config_dir = dirs::home_dir()
        .ok_or_else(|| "No home directory".to_string())?
        .join(".otto");

    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    let config_path = config_dir.join("desktop-projects.json");
    let mut projects = get_recent_projects().await.unwrap_or_default();

    projects.retain(|p| p.path != project.path);
    projects.insert(0, project);
    projects.truncate(10);

    let content = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;

    std::fs::write(&config_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_recent_project(path: String) -> Result<(), String> {
    let config_path = get_projects_config_path()?;
    let mut projects = get_recent_projects().await.unwrap_or_default();

    projects.retain(|p| p.path != path);

    let content = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;

    std::fs::write(&config_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_project_pinned(path: String) -> Result<(), String> {
    let config_path = get_projects_config_path()?;
    let mut projects = get_recent_projects().await.unwrap_or_default();

    if let Some(project) = projects.iter_mut().find(|p| p.path == path) {
        project.pinned = !project.pinned;
    }

    let content = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;

    std::fs::write(&config_path, content).map_err(|e| e.to_string())
}

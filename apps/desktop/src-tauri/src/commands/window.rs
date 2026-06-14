use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewWindowBuilder};

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

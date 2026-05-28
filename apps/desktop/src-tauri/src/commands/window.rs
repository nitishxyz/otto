use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[tauri::command]
pub async fn create_new_window(app: AppHandle) -> Result<(), String> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{}", count);

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("otto")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .decorations(true)
        .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::LogicalPosition;
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(10.0, 20.0))
    };

    #[cfg(target_os = "linux")]
    let builder = builder.decorations(false);

    builder.build().map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

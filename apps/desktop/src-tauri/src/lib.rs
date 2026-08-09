mod commands;
mod startup_target;
mod voice_shortcut;

use commands::server::ServerState;
use startup_target::StartupTarget;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;
use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
pub fn run_notification_helper(args: &[String]) -> i32 {
    commands::notification::run_notification_helper(args)
}

pub struct InitialProjectState(pub StartupTarget<String>);

pub struct InitialRemoteState(pub StartupTarget<(String, String)>);

fn parse_project_arg() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--project" {
            if let Some(path) = args.get(i + 1) {
                let p = std::path::Path::new(path);
                if p.exists() && p.is_dir() {
                    return Some(path.clone());
                }
            }
        }
    }
    None
}

fn parse_remote_args() -> (Option<String>, Option<String>) {
    let args: Vec<String> = std::env::args().collect();
    let mut url = None;
    let mut name = None;
    for i in 0..args.len() {
        if args[i] == "--remote" {
            url = args.get(i + 1).cloned();
        }
        if args[i] == "--name" {
            name = args.get(i + 1).cloned();
        }
    }
    (url, name)
}

/// Startup targets are claimed per window rather than consumed, so a window
/// whose init effect runs more than once still opens the requested project.
#[tauri::command]
fn get_initial_project(
    window: WebviewWindow,
    state: tauri::State<'_, InitialProjectState>,
) -> Option<String> {
    state.0.claim_for(window.label())
}

#[tauri::command]
fn get_initial_remote(
    window: WebviewWindow,
    state: tauri::State<'_, InitialRemoteState>,
) -> Option<(String, String)> {
    state.0.claim_for(window.label())
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    commands::notification::cleanup_stale_notification_helpers();

    let initial_project = parse_project_arg();
    if let Some(ref p) = initial_project {
        eprintln!("[otto] CLI requested project: {}", p);
    }

    let (initial_remote_url, initial_remote_name) = parse_remote_args();
    if let Some(ref u) = initial_remote_url {
        eprintln!("[otto] CLI requested remote: {}", u);
    }
    // A remote needs a URL; the name is only a label, so default it here and
    // keep the claimed value a single ready-to-use pair.
    let initial_remote = initial_remote_url
        .map(|url| (url, initial_remote_name.unwrap_or_else(|| "Remote".to_string())));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ServerState::default())
        .manage(commands::machine::MachineWindowState::default())
        .manage(commands::native_terminal::NativeTerminalManager::new())
        .manage(commands::updater::PendingUpdate(Mutex::new(None)))
        .manage(commands::updater::ReadyUpdate(Mutex::new(None)))
        .manage(InitialProjectState(StartupTarget::new(initial_project)))
        .manage(InitialRemoteState(StartupTarget::new(initial_remote)))
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            voice_shortcut::install(app.handle().clone());

            let new_window = MenuItemBuilder::new("New Window")
                .id("new_window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;

            let check_updates = MenuItemBuilder::new("Check for Updates...")
                .id("check_for_updates")
                .build(app)?;

            // Custom Close item: the predefined close_window() accelerator
            // fires natively before the webview sees Cmd+W, which would close
            // the window even when a viewer tab should be closed instead. The
            // frontend closes the active tab or asks the window to close.
            let close_window = MenuItemBuilder::new("Close Window")
                .id("close_window")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_window)
                .separator()
                .item(&check_updates)
                .separator()
                .item(&close_window)
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            #[cfg(target_os = "linux")]
            {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "new_window" {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::window::create_new_window(handle).await;
                });
            } else if event.id().as_ref() == "check_for_updates" {
                let _ = app.emit("menu-check-for-updates", ());
            } else if event.id().as_ref() == "close_window" {
                let focused = app
                    .webview_windows()
                    .into_values()
                    .find(|window| window.is_focused().unwrap_or(false));
                if let Some(window) = focused {
                    let _ = app.emit_to(window.label(), "menu-close-request", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::copy_to_clipboard,
            commands::project::open_project_dialog,
            commands::server::ensure_desktop_daemon,
            commands::server::stop_desktop_daemon,
            commands::server::get_cli_selection,
            commands::server::update_installed_cli,
            commands::native_browser::native_browser_mount,
            commands::native_browser::native_browser_control,
            commands::native_browser::native_browser_execute,
            commands::native_browser::native_browser_screenshot,
            commands::native_browser::native_browser_set_visible,
            commands::native_browser::native_browser_unmount,
            commands::native_terminal::native_terminal_status,
            commands::native_terminal::native_terminal_create,
            commands::native_terminal::native_terminal_set_theme,
            commands::native_terminal::native_terminal_feed,
            commands::native_terminal::native_terminal_feed_gpu,
            commands::native_terminal::native_terminal_resize,
            commands::native_terminal::native_terminal_key,
            commands::native_terminal::native_terminal_scroll,
            commands::native_terminal::native_terminal_scroll_gpu,
            commands::native_terminal::native_terminal_select,
            commands::native_terminal::native_terminal_reset,
            commands::native_terminal::native_terminal_destroy,
            commands::native_terminal::native_terminal_surface_create,
            commands::native_terminal::native_terminal_surface_update,
            commands::native_terminal::native_terminal_surface_set_font,
            commands::native_terminal::native_terminal_surface_cursor,
            commands::native_terminal::native_terminal_surface_destroy,
            commands::fonts::list_system_fonts,
            commands::window::create_new_window,
            commands::window::open_machine_window,
            commands::machine::get_machine_bootstrap,
            commands::machine::set_current_machine,
            commands::machine::set_machine_window_project,
            commands::notification::show_native_notification,
            get_initial_project,
            get_initial_remote,
            get_platform,
            commands::updater::check_for_update,
            commands::updater::download_update,
            commands::updater::apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

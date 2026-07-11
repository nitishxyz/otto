mod commands;
mod voice_shortcut;

use commands::server::ServerState;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
#[cfg(target_os = "linux")]
use tauri::Manager;

#[cfg(target_os = "macos")]
pub fn run_notification_helper(args: &[String]) -> i32 {
    commands::notification::run_notification_helper(args)
}

pub struct InitialProjectState {
    pub path: Mutex<Option<String>>,
}

pub struct InitialRemoteState {
    pub url: Mutex<Option<String>>,
    pub name: Mutex<Option<String>>,
}

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

#[tauri::command]
fn get_initial_project(state: tauri::State<'_, InitialProjectState>) -> Option<String> {
    state.path.lock().unwrap().take()
}

#[tauri::command]
fn get_initial_remote(state: tauri::State<'_, InitialRemoteState>) -> Option<(String, String)> {
    let url = state.url.lock().unwrap().take();
    let name = state.name.lock().unwrap().take();
    match (url, name) {
        (Some(u), Some(n)) => Some((u, n)),
        (Some(u), None) => Some((u, "Remote".to_string())),
        _ => None,
    }
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_project = parse_project_arg();
    if let Some(ref p) = initial_project {
        eprintln!("[otto] CLI requested project: {}", p);
    }

    let (initial_remote_url, initial_remote_name) = parse_remote_args();
    if let Some(ref u) = initial_remote_url {
        eprintln!("[otto] CLI requested remote: {}", u);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ServerState::default())
        .manage(commands::machine::MachineWindowState::default())
        .manage(commands::updater::PendingUpdate(Mutex::new(None)))
        .manage(commands::updater::ReadyUpdate(Mutex::new(None)))
        .manage(InitialProjectState {
            path: Mutex::new(initial_project),
        })
        .manage(InitialRemoteState {
            url: Mutex::new(initial_remote_url),
            name: Mutex::new(initial_remote_name),
        })
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

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_window)
                .separator()
                .item(&check_updates)
                .separator()
                .close_window()
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
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::copy_to_clipboard,
            commands::project::open_project_dialog,
            commands::project::get_recent_projects,
            commands::project::save_recent_project,
            commands::project::remove_recent_project,
            commands::project::toggle_project_pinned,
            commands::project::get_general_workspace_path,
            commands::server::start_server,
            commands::server::ensure_desktop_daemon,
            commands::server::stop_desktop_daemon,
            commands::server::stop_server,
            commands::server::stop_all_servers,
            commands::server::list_servers,
            commands::server::get_cli_selection,
            commands::server::update_installed_cli,
            commands::github::github_save_token,
            commands::github::github_get_token,
            commands::github::github_logout,
            commands::github::github_get_user,
            commands::github::github_list_repos,
            commands::github::github_device_code_request,
            commands::github::github_device_code_poll,
            commands::native_browser::native_browser_mount,
            commands::native_browser::native_browser_set_visible,
            commands::native_browser::native_browser_unmount,
            commands::git::git_clone,
            commands::git::git_status,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_is_repo,
            commands::fonts::list_system_fonts,
            commands::window::create_new_window,
            commands::window::open_machine_window,
            commands::machine::get_machine_bootstrap,
            commands::machine::set_machine_window_project,
            commands::notification::show_native_notification,
            get_initial_project,
            get_initial_remote,
            get_platform,
            commands::onboarding::get_onboarding_status,
            commands::onboarding::generate_wallet,
            commands::onboarding::add_provider,
            commands::onboarding::remove_provider,
            commands::onboarding::set_defaults,
            commands::onboarding::complete_onboarding,
            commands::onboarding::get_home_directory,
            commands::updater::check_for_update,
            commands::updater::download_update,
            commands::updater::apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

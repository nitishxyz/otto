// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    {
        let args: Vec<String> = std::env::args().collect();
        if args
            .get(1)
            .is_some_and(|arg| arg == "--otto-notification-helper")
        {
            std::process::exit(otto_desktop_lib::run_notification_helper(&args[1..]));
        }
    }

    otto_desktop_lib::run()
}

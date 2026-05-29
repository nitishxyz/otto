#[cfg(target_os = "macos")]
use std::ptr::NonNull;
#[cfg(target_os = "macos")]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};

#[cfg(target_os = "macos")]
const FN_KEY_CODE: u16 = 63;
const VOICE_SHORTCUT_DOWN_EVENT: &str = "otto:voice-shortcut-down";
const VOICE_SHORTCUT_UP_EVENT: &str = "otto:voice-shortcut-up";

#[cfg(target_os = "macos")]
fn emit_shortcut_event(app: &AppHandle, event_name: &str) {
    if let Err(error) = app.emit(event_name, ()) {
        eprintln!("[otto] Failed to emit voice shortcut event: {error}");
    }
}

#[cfg(target_os = "macos")]
fn emit_shortcut_transition(app: &AppHandle, pressed: bool, is_pressed: &AtomicBool) {
    let previous = is_pressed.swap(pressed, Ordering::SeqCst);
    if previous == pressed {
        return;
    }

    emit_shortcut_event(
        app,
        if pressed {
            VOICE_SHORTCUT_DOWN_EVENT
        } else {
            VOICE_SHORTCUT_UP_EVENT
        },
    );
}

pub fn install(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let is_pressed = Arc::new(AtomicBool::new(false));
        let callback_app = app.clone();
        let callback_is_pressed = Arc::clone(&is_pressed);

        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit invokes local event monitor blocks with a valid NSEvent
            // and expects either the original event pointer or null. We never retain
            // the event; we only inspect flags/keyCode and return it unchanged.
            let event_ref = unsafe { event.as_ref() };
            let key_code = event_ref.keyCode();
            let contains_fn = event_ref
                .modifierFlags()
                .contains(NSEventModifierFlags::Function);

            if key_code == FN_KEY_CODE || contains_fn {
                emit_shortcut_transition(&callback_app, contains_fn, &callback_is_pressed);
            }

            event.as_ptr()
        });

        // Local monitors only observe events while this app is active, so they do
        // not require Input Monitoring. Keep both objects alive for app lifetime.
        let monitor = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &block)
        };

        if let Some(monitor) = monitor {
            Box::leak(Box::new(block));
            Box::leak(Box::new(monitor));
        } else {
            eprintln!("[otto] Failed to install local Globe/Fn key monitor");
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

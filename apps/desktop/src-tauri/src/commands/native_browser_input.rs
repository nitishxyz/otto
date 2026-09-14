#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserInput {
    Click { x: f64, y: f64 },
    Hover { x: f64, y: f64 },
    Text { text: String },
    Key { key: String },
}

pub async fn send(webview: &tauri::Webview, input: BrowserInput) -> Result<(), String> {
    let hover = match &input {
        BrowserInput::Hover { x, y } => Some((*x, *y)),
        _ => None,
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            #[cfg(target_os = "macos")]
            let result = unsafe { send_macos(platform.inner(), input) };
            #[cfg(not(target_os = "macos"))]
            let result: Result<(), String> = {
                let _ = (platform, input);
                Err("native browser input is only supported on macOS today".to_string())
            };
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "browser input timed out".to_string())?
        .map_err(|_| "browser input channel closed".to_string())??;
    if let Some((x, y)) = hover {
        // AppKit can ignore local motion when the system pointer is elsewhere.
        // Never claim hover succeeded unless WebKit actually changed CSS state.
        let script = format!(
            "(() => {{ const element = document.elementFromPoint({x}, {y}); return !!element && element.matches(':hover'); }})()"
        );
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            if super::native_browser_script::execute(webview, script.clone(), false).await?
                == serde_json::Value::Bool(true)
            {
                return Ok(());
            }
        }
        return Err("native browser hover is unavailable: WebKit did not confirm CSS :hover without moving the system cursor".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn send_macos(handle: *mut std::ffi::c_void, input: BrowserInput) -> Result<(), String> {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
    use objc2_foundation::{NSPoint, NSString};
    use objc2_web_kit::WKWebView;

    if handle.is_null() {
        return Err("native webview handle is unavailable".to_string());
    }
    // SAFETY: with_webview dispatches to the main thread with a live WKWebView.
    let view = &*(handle as *mut WKWebView);
    let window = view.window().ok_or("browser tab has no native window")?;
    if view.isHiddenOrHasHiddenAncestor() {
        return Err("browser tab must be visible for native input".to_string());
    }
    if !matches!(input, BrowserInput::Hover { .. }) {
        window.makeKeyWindow();
        if !window.makeFirstResponder(Some(view)) {
            return Err("browser tab could not acquire keyboard focus".to_string());
        }
    }
    let hover = matches!(input, BrowserInput::Hover { .. });
    match input {
        BrowserInput::Click { x, y } | BrowserInput::Hover { x, y } => {
            let x = x * view.pageZoom();
            let y = y * view.pageZoom();
            let bounds = view.bounds();
            if !x.is_finite()
                || !y.is_finite()
                || x < 0.0
                || y < 0.0
                || x >= bounds.size.width
                || y >= bounds.size.height
            {
                return Err("browser pointer coordinates are outside the viewport".to_string());
            }
            let local = NSPoint::new(
                x,
                if view.isFlipped() {
                    y
                } else {
                    bounds.size.height - y
                },
            );
            let point = view.convertPoint_toView(local, None);
            let event_types: &[NSEventType] = if hover {
                &[NSEventType::MouseMoved]
            } else {
                &[NSEventType::LeftMouseDown, NSEventType::LeftMouseUp]
            };
            for &event_type in event_types {
                let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                    event_type, point, NSEventModifierFlags::empty(), 0.0, window.windowNumber(), None, 0, if hover { 0 } else { 1 }, if hover { 0.0 } else { 1.0 },
                ).ok_or("could not create native browser mouse event")?;
                let accepts_motion = window.acceptsMouseMovedEvents();
                if hover {
                    window.setAcceptsMouseMovedEvents(true);
                }
                window.sendEvent(&event);
                if hover {
                    window.setAcceptsMouseMovedEvents(accepts_motion);
                }
            }
        }
        BrowserInput::Text { text } => {
            if text.len() > 64 * 1024 {
                return Err("browser input exceeds the 64 KiB limit".to_string());
            }
            for character in text.chars() {
                send_key(&window, &NSString::from_str(&character.to_string()), 0)?;
            }
        }
        BrowserInput::Key { key } => {
            let (characters, code) = match key.as_str() {
                "Enter" => ("\r", 36),
                "Tab" => ("\t", 48),
                "Backspace" => ("\u{7f}", 51),
                "Escape" => ("\u{1b}", 53),
                "ArrowLeft" => ("\u{f702}", 123),
                "ArrowRight" => ("\u{f703}", 124),
                "ArrowDown" => ("\u{f701}", 125),
                "ArrowUp" => ("\u{f700}", 126),
                _ => return Err(format!("unsupported native browser key: {key}")),
            };
            send_key(&window, &NSString::from_str(characters), code)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn send_key(
    window: &objc2_app_kit::NSWindow,
    characters: &objc2_foundation::NSString,
    code: u16,
) -> Result<(), String> {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
    use objc2_foundation::NSPoint;

    for event_type in [NSEventType::KeyDown, NSEventType::KeyUp] {
        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            event_type, NSPoint::new(0.0, 0.0), NSEventModifierFlags::empty(), 0.0,
            window.windowNumber(), None, characters, characters, false, code,
        ).ok_or("could not create native browser key event")?;
        window.sendEvent(&event);
    }
    Ok(())
}

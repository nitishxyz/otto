use std::time::Duration;

pub async fn execute(
    webview: &tauri::Webview,
    script: String,
    function_body: bool,
) -> Result<serde_json::Value, String> {
    if script.len() > 256 * 1024 {
        return Err("browser script exceeds the 256 KiB limit".to_string());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    evaluate(webview, script, function_body, sender)?;
    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "browser script timed out".to_string())?
        .map_err(|_| "browser script result channel closed".to_string())?
}

#[cfg(target_os = "macos")]
fn evaluate(
    webview: &tauri::Webview,
    script: String,
    function_body: bool,
    sender: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use std::sync::Mutex;

    webview
        .with_webview(move |platform| {
            let handle = platform.inner();
            if handle.is_null() {
                let _ = sender.send(Err("native webview handle is unavailable".to_string()));
                return;
            }
            let sender = Mutex::new(Some(sender));
            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        // SAFETY: WebKit owns the callback values for this invocation.
                        let _ = sender.send(unsafe { decode_result(value, error) });
                    }
                }
            });
            // SAFETY: Tauri dispatches this closure to the main thread with a live WKWebView.
            unsafe {
                let view = &*(handle as *mut WKWebView);
                let source = NSString::from_str(&script);
                if function_body {
                    view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                        &source,
                        None,
                        None,
                        &WKContentWorld::pageWorld(objc2::MainThreadMarker::new_unchecked()),
                        Some(&handler),
                    );
                } else {
                    view.evaluateJavaScript_completionHandler(&source, Some(&handler));
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
unsafe fn decode_result(
    value: *mut objc2::runtime::AnyObject,
    error: *mut objc2_foundation::NSError,
) -> Result<serde_json::Value, String> {
    use objc2_foundation::{NSJSONSerialization, NSJSONWritingOptions};

    if !error.is_null() {
        return Err((*error).localizedDescription().to_string());
    }
    if value.is_null() {
        return Ok(serde_json::Value::Null);
    }
    let data = NSJSONSerialization::dataWithJSONObject_options_error(
        &*value,
        NSJSONWritingOptions::FragmentsAllowed,
    )
    .map_err(|error| format!("browser result is not JSON serializable: {error}"))?;
    if data.len() > 1024 * 1024 {
        return Err("browser script result exceeds the 1 MiB limit".to_string());
    }
    serde_json::from_slice(&data.to_vec()).map_err(|error| error.to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::decode_result;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};
    use std::ptr::null_mut;

    #[test]
    fn native_exceptions_reject_instead_of_becoming_empty_results() {
        let error = unsafe {
            NSError::errorWithDomain_code_userInfo(&NSString::from_str("WKErrorDomain"), 4, None)
        };
        let result =
            unsafe { decode_result(null_mut(), &*error as *const NSError as *mut NSError) };
        assert!(result.is_err());
    }

    #[test]
    fn native_values_are_json_and_undefined_is_null() {
        let value = NSString::from_str("result");
        let result =
            unsafe { decode_result(&*value as *const NSString as *mut AnyObject, null_mut()) };
        assert_eq!(result.unwrap(), serde_json::json!("result"));
        assert_eq!(
            unsafe { decode_result(null_mut(), null_mut()) }.unwrap(),
            serde_json::Value::Null
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn evaluate(
    webview: &tauri::Webview,
    script: String,
    function_body: bool,
    sender: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
) -> Result<(), String> {
    use std::sync::Mutex;

    if function_body {
        return Err("async browser execution is only supported on macOS today".to_string());
    }
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |raw| {
            let result = if raw.len() > 1024 * 1024 {
                Err("browser script result exceeds the 1 MiB limit".to_string())
            } else {
                serde_json::from_str(&raw).map_err(|_| {
                    "browser script returned no valid result (evaluation may have failed)"
                        .to_string()
                })
            };
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| error.to_string())
}

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::sync::watch;

const BROKER_EVENT: &str = "otto:desktop-event-stream";
const RECONNECT_BASE_DELAY_MS: u64 = 1_000;
const RECONNECT_MAX_DELAY_MS: u64 = 15_000;

#[derive(Clone, PartialEq, Eq)]
struct BrokerSource {
    base_url: String,
    token: String,
}

#[derive(Clone)]
struct WindowSubscription {
    subscription_id: String,
    project_id: String,
    project_root: String,
}

struct BrokerInner {
    source: Option<BrokerSource>,
    subscriptions: HashMap<String, WindowSubscription>,
    cancel: Option<watch::Sender<bool>>,
    generation: u64,
    status: BrokerStatus,
    last_event_id: Option<String>,
}

impl Default for BrokerInner {
    fn default() -> Self {
        Self {
            source: None,
            subscriptions: HashMap::new(),
            cancel: None,
            generation: 0,
            status: BrokerStatus::Idle,
            last_event_id: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct DesktopEventBroker {
    inner: Arc<Mutex<BrokerInner>>,
    remote_cancels: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BrokerStatus {
    Idle,
    Connecting,
    Connected,
    Retrying,
    Unsupported,
}

impl BrokerStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Retrying => "retrying",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEventBrokerStatus {
    status: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrokerMessage {
    State {
        subscription_id: String,
        status: String,
        attempt: u32,
        delay: u64,
    },
    Chunk {
        subscription_id: String,
        chunk: String,
    },
}

struct ParsedFrame {
    raw: String,
    id: Option<String>,
    project_id: Option<String>,
    project_root: Option<String>,
}

#[derive(Default)]
struct SseParser {
    buffer: Vec<u8>,
}

impl SseParser {
    fn push(&mut self, bytes: &[u8]) -> Vec<ParsedFrame> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some(index) = self.buffer.windows(2).position(|item| item == b"\n\n") {
            let frame = self.buffer.drain(..index + 2).collect::<Vec<_>>();
            let raw = String::from_utf8_lossy(&frame).into_owned();
            frames.push(parse_frame(raw));
        }
        frames
    }
}

fn parse_frame(raw: String) -> ParsedFrame {
    let mut id = None;
    let mut data = String::new();
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix("id:") {
            id = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.trim_start());
        }
    }
    let payload = serde_json::from_str::<Value>(&data).ok();
    let project_id = payload
        .as_ref()
        .and_then(|value| value.get("projectId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let project_root = payload
        .as_ref()
        .and_then(|value| value.get("projectRoot"))
        .and_then(Value::as_str)
        .map(str::to_string);
    ParsedFrame {
        raw,
        id,
        project_id,
        project_root,
    }
}

fn normalized_base_url(value: &str) -> Result<String, String> {
    let parsed = url::Url::parse(value).map_err(|_| "Invalid daemon URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Daemon URL must use http or https".to_string());
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn matching_windows(
    inner: &BrokerInner,
    project_id: Option<&str>,
    project_root: Option<&str>,
) -> Vec<(String, String)> {
    inner
        .subscriptions
        .iter()
        .filter_map(|(label, subscription)| {
            let matches = match (project_id, project_root) {
                (Some(id), Some(root)) => {
                    subscription.project_id == id || subscription.project_root == root
                }
                (Some(id), None) => subscription.project_id == id,
                (None, Some(root)) => subscription.project_root == root,
                (None, None) => true,
            };
            matches.then(|| (label.clone(), subscription.subscription_id.clone()))
        })
        .collect()
}

fn emit_state(
    app: &AppHandle,
    inner: &Arc<Mutex<BrokerInner>>,
    generation: u64,
    status: BrokerStatus,
    attempt: u32,
    delay: u64,
) {
    let subscriptions = {
        let mut guard = inner.lock().unwrap_or_else(|error| error.into_inner());
        if guard.generation != generation {
            return;
        }
        guard.status = status;
        guard
            .subscriptions
            .iter()
            .map(|(label, subscription)| (label.clone(), subscription.subscription_id.clone()))
            .collect::<Vec<_>>()
    };
    for (label, subscription_id) in subscriptions {
        let payload = BrokerMessage::State {
            subscription_id,
            status: status.as_str().to_string(),
            attempt,
            delay,
        };
        let _ = app.emit_to(label, BROKER_EVENT, payload.clone());
    }
}

fn emit_frame(
    app: &AppHandle,
    inner: &Arc<Mutex<BrokerInner>>,
    generation: u64,
    frame: &ParsedFrame,
) {
    let subscriptions = {
        let guard = inner.lock().unwrap_or_else(|error| error.into_inner());
        if guard.generation != generation {
            return;
        }
        matching_windows(
            &guard,
            frame.project_id.as_deref(),
            frame.project_root.as_deref(),
        )
    };
    for (label, subscription_id) in subscriptions {
        let payload = BrokerMessage::Chunk {
            subscription_id,
            chunk: frame.raw.clone(),
        };
        let _ = app.emit_to(label, BROKER_EVENT, payload.clone());
    }
}

fn emit_remote_state(
    app: &AppHandle,
    window_label: &str,
    subscription_id: &str,
    status: BrokerStatus,
    attempt: u32,
    delay: u64,
) {
    let _ = app.emit_to(
        window_label,
        BROKER_EVENT,
        BrokerMessage::State {
            subscription_id: subscription_id.to_string(),
            status: status.as_str().to_string(),
            attempt,
            delay,
        },
    );
}

async fn run_remote_project_stream(
    app: AppHandle,
    window_label: String,
    subscription_id: String,
    base_url: String,
    owner_session: String,
    project_id: String,
    project_root: String,
    mut cancel: watch::Receiver<bool>,
) {
    let client = match reqwest::Client::builder().build() {
        Ok(client) => client,
        Err(_) => {
            emit_remote_state(
                &app,
                &window_label,
                &subscription_id,
                BrokerStatus::Unsupported,
                0,
                0,
            );
            return;
        }
    };
    let mut url = match url::Url::parse(&format!("{base_url}/v1/events/project")) {
        Ok(url) => url,
        Err(_) => return,
    };
    url.query_pairs_mut()
        .append_pair("projectId", &project_id)
        .append_pair("project", &project_root);
    let mut attempt = 0_u32;

    loop {
        emit_remote_state(
            &app,
            &window_label,
            &subscription_id,
            BrokerStatus::Connecting,
            attempt,
            0,
        );
        let response = tokio::select! {
            response = client
                .post(url.clone())
                .header("accept", "text/event-stream")
                .header("x-otto-owner-session", &owner_session)
                .send() => response,
            _ = cancel.changed() => return,
        };
        let response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(response)
                if response.status() == reqwest::StatusCode::NOT_FOUND
                    || response.status() == reqwest::StatusCode::METHOD_NOT_ALLOWED =>
            {
                emit_remote_state(
                    &app,
                    &window_label,
                    &subscription_id,
                    BrokerStatus::Unsupported,
                    attempt,
                    0,
                );
                return;
            }
            _ => {
                attempt = attempt.saturating_add(1);
                let delay = (RECONNECT_BASE_DELAY_MS.saturating_mul(2_u64.pow(attempt.min(4))))
                    .min(RECONNECT_MAX_DELAY_MS);
                emit_remote_state(
                    &app,
                    &window_label,
                    &subscription_id,
                    BrokerStatus::Retrying,
                    attempt,
                    delay,
                );
                if wait_or_cancel(Duration::from_millis(delay), &mut cancel).await {
                    return;
                }
                continue;
            }
        };

        emit_remote_state(
            &app,
            &window_label,
            &subscription_id,
            BrokerStatus::Connected,
            0,
            0,
        );
        let mut stream = response.bytes_stream();
        let mut received = false;
        loop {
            let next = tokio::select! {
                next = stream.next() => next,
                _ = cancel.changed() => return,
            };
            let Some(result) = next else { break };
            let Ok(bytes) = result else { break };
            received = true;
            let _ = app.emit_to(
                &window_label,
                BROKER_EVENT,
                BrokerMessage::Chunk {
                    subscription_id: subscription_id.clone(),
                    chunk: String::from_utf8_lossy(&bytes).into_owned(),
                },
            );
        }

        attempt = if received {
            0
        } else {
            attempt.saturating_add(1)
        };
        let delay = (RECONNECT_BASE_DELAY_MS.saturating_mul(2_u64.pow(attempt.min(4))))
            .min(RECONNECT_MAX_DELAY_MS);
        emit_remote_state(
            &app,
            &window_label,
            &subscription_id,
            BrokerStatus::Retrying,
            attempt,
            delay,
        );
        if wait_or_cancel(Duration::from_millis(delay), &mut cancel).await {
            return;
        }
    }
}

async fn wait_or_cancel(delay: Duration, cancel: &mut watch::Receiver<bool>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(delay) => false,
        _ = cancel.changed() => true,
    }
}

async fn run_broker(
    app: AppHandle,
    inner: Arc<Mutex<BrokerInner>>,
    source: BrokerSource,
    generation: u64,
    mut cancel: watch::Receiver<bool>,
) {
    let client = match reqwest::Client::builder().build() {
        Ok(client) => client,
        Err(_) => {
            emit_state(&app, &inner, generation, BrokerStatus::Unsupported, 0, 0);
            return;
        }
    };
    let url = format!("{}/v1/events/desktop", source.base_url);
    let mut last_event_id = {
        let guard = inner.lock().unwrap_or_else(|error| error.into_inner());
        guard.last_event_id.clone()
    };
    let mut attempt = 0_u32;

    loop {
        emit_state(
            &app,
            &inner,
            generation,
            BrokerStatus::Connecting,
            attempt,
            0,
        );
        let mut request = client
            .get(&url)
            .header("accept", "text/event-stream")
            .header("x-otto-server-token", &source.token);
        if let Some(event_id) = &last_event_id {
            request = request.header("last-event-id", event_id);
        }
        let response = tokio::select! {
            response = request.send() => response,
            _ = cancel.changed() => return,
        };

        let response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(response)
                if response.status() == reqwest::StatusCode::NOT_FOUND
                    || response.status() == reqwest::StatusCode::METHOD_NOT_ALLOWED =>
            {
                emit_state(
                    &app,
                    &inner,
                    generation,
                    BrokerStatus::Unsupported,
                    attempt,
                    0,
                );
                return;
            }
            _ => {
                attempt = attempt.saturating_add(1);
                let delay = (RECONNECT_BASE_DELAY_MS.saturating_mul(2_u64.pow(attempt.min(4))))
                    .min(RECONNECT_MAX_DELAY_MS);
                emit_state(
                    &app,
                    &inner,
                    generation,
                    BrokerStatus::Retrying,
                    attempt,
                    delay,
                );
                if wait_or_cancel(Duration::from_millis(delay), &mut cancel).await {
                    return;
                }
                continue;
            }
        };

        emit_state(&app, &inner, generation, BrokerStatus::Connected, 0, 0);
        let mut parser = SseParser::default();
        let mut stream = response.bytes_stream();
        let mut received = false;
        loop {
            let next = tokio::select! {
                next = stream.next() => next,
                _ = cancel.changed() => return,
            };
            let Some(result) = next else {
                break;
            };
            let Ok(bytes) = result else {
                break;
            };
            received = true;
            for frame in parser.push(&bytes) {
                if let Some(id) = &frame.id {
                    last_event_id = Some(id.clone());
                    let mut guard = inner.lock().unwrap_or_else(|error| error.into_inner());
                    if guard.generation == generation {
                        guard.last_event_id = Some(id.clone());
                    }
                }
                emit_frame(&app, &inner, generation, &frame);
            }
        }

        attempt = if received {
            0
        } else {
            attempt.saturating_add(1)
        };
        let delay = (RECONNECT_BASE_DELAY_MS.saturating_mul(2_u64.pow(attempt.min(4))))
            .min(RECONNECT_MAX_DELAY_MS);
        emit_state(
            &app,
            &inner,
            generation,
            BrokerStatus::Retrying,
            attempt,
            delay,
        );
        if wait_or_cancel(Duration::from_millis(delay), &mut cancel).await {
            return;
        }
    }
}

#[tauri::command]
pub async fn subscribe_desktop_events(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopEventBroker>,
    base_url: String,
    token: String,
    project_id: String,
    project_root: String,
    subscription_id: String,
) -> Result<DesktopEventBrokerStatus, String> {
    let source = BrokerSource {
        base_url: normalized_base_url(&base_url)?,
        token,
    };
    let mut start = None;
    let status = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Desktop event broker state is unavailable".to_string())?;
        inner.subscriptions.insert(
            window.label().to_string(),
            WindowSubscription {
                subscription_id,
                project_id,
                project_root,
            },
        );
        if inner.source.as_ref() != Some(&source) {
            if let Some(cancel) = inner.cancel.take() {
                let _ = cancel.send(true);
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.source = Some(source.clone());
            inner.last_event_id = None;
            inner.status = BrokerStatus::Connecting;
            let (cancel_tx, cancel_rx) = watch::channel(false);
            inner.cancel = Some(cancel_tx);
            start = Some((inner.generation, cancel_rx));
        } else if inner.cancel.is_none() && inner.status != BrokerStatus::Unsupported {
            let (cancel_tx, cancel_rx) = watch::channel(false);
            inner.cancel = Some(cancel_tx);
            inner.status = BrokerStatus::Connecting;
            start = Some((inner.generation, cancel_rx));
        }
        inner.status
    };

    if let Some((generation, cancel)) = start {
        let app_handle = app.clone();
        let broker_inner = state.inner.clone();
        tauri::async_runtime::spawn(async move {
            run_broker(app_handle, broker_inner, source, generation, cancel).await;
        });
    }

    Ok(DesktopEventBrokerStatus {
        status: status.as_str().to_string(),
    })
}

#[tauri::command]
pub async fn subscribe_remote_project_events(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, DesktopEventBroker>,
    base_url: String,
    token: String,
    project_id: String,
    project_root: String,
    subscription_id: String,
) -> Result<DesktopEventBrokerStatus, String> {
    let base_url = normalized_base_url(&base_url)?;
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut cancels = state
            .remote_cancels
            .lock()
            .map_err(|_| "Remote event broker state is unavailable".to_string())?;
        if let Some(previous) = cancels.insert(subscription_id.clone(), cancel_tx) {
            let _ = previous.send(true);
        }
    }
    tauri::async_runtime::spawn(run_remote_project_stream(
        app,
        window.label().to_string(),
        subscription_id,
        base_url,
        token,
        project_id,
        project_root,
        cancel_rx,
    ));
    Ok(DesktopEventBrokerStatus {
        status: BrokerStatus::Connecting.as_str().to_string(),
    })
}

#[tauri::command]
pub fn unsubscribe_desktop_events(
    window: WebviewWindow,
    state: State<'_, DesktopEventBroker>,
    subscription_id: String,
) -> Result<(), String> {
    if let Some(cancel) = state
        .remote_cancels
        .lock()
        .map_err(|_| "Remote event broker state is unavailable".to_string())?
        .remove(&subscription_id)
    {
        let _ = cancel.send(true);
    }
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Desktop event broker state is unavailable".to_string())?;
    let matches = inner
        .subscriptions
        .get(window.label())
        .is_some_and(|subscription| subscription.subscription_id == subscription_id);
    if matches {
        inner.subscriptions.remove(window.label());
    }
    if inner.subscriptions.is_empty() {
        if let Some(cancel) = inner.cancel.take() {
            let _ = cancel.send(true);
        }
        if inner.status != BrokerStatus::Unsupported {
            inner.status = BrokerStatus::Idle;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fragmented_frames_and_project_routing() {
        let mut parser = SseParser::default();
        assert!(parser.push(b"id: 12\nevent: message").is_empty());
        let frames = parser
            .push(b".created\ndata: {\"projectId\":\"agi\",\"projectRoot\":\"/tmp/agi\"}\n\n");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].id.as_deref(), Some("12"));
        assert_eq!(frames[0].project_id.as_deref(), Some("agi"));
        assert_eq!(frames[0].project_root.as_deref(), Some("/tmp/agi"));
    }
}

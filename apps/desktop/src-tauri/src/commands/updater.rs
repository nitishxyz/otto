use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Read as _, Write as _};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_updater::UpdaterExt;

const UPDATE_URL: &str =
    "https://github.com/nitishxyz/otto/releases/download/desktop-latest/latest.json";

pub struct PendingUpdate(pub Mutex<Option<PendingUpdateData>>);
pub struct ReadyUpdate(pub Mutex<Option<ReadyUpdateData>>);

pub struct PendingUpdateData {
    pub url: String,
    pub signature: String,
    pub version: String,
}

pub struct ReadyUpdateData {
    pub bytes: Vec<u8>,
    pub update: tauri_plugin_updater::Update,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
        downloaded: u64,
    },
    Finished,
}

#[derive(Deserialize)]
struct PlatformEntry {
    signature: String,
    url: String,
}

#[derive(Deserialize)]
struct LatestJson {
    version: String,
    platforms: std::collections::HashMap<String, PlatformEntry>,
}

fn current_platform_key() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-aarch64"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    {
        "unsupported"
    }
}

fn serve_json_once(json_bytes: Vec<u8>) -> Result<u16, String> {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind failed: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("{e}"))?.port();

    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                json_bytes.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&json_bytes);
            let _ = stream.flush();
        }
    });

    Ok(port)
}

fn global_debug_log_path() -> Option<PathBuf> {
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))?;

    Some(config_home.join("otto").join("debug").join("latest.log"))
}

fn write_update_trace(message: impl AsRef<str>) {
    let Some(path) = global_debug_log_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{} [trace] [desktop:update] {}",
            chrono::Utc::now().to_rfc3339(),
            message.as_ref()
        );
    }
}

#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    match check_for_update_impl(app, state).await {
        Ok(result) => Ok(result),
        Err(error) => {
            write_update_trace(format!("check_for_update failed: {error}"));
            Ok(None)
        }
    }
}

async fn check_for_update_impl(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let current_version = app.config().version.clone().unwrap_or_default();
    let platform_key = current_platform_key();

    let response = reqwest::get(UPDATE_URL)
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    let latest: LatestJson = response
        .json()
        .await
        .map_err(|e| format!("parse failed: {e}"))?;

    let current = semver::Version::parse(&current_version).unwrap_or(semver::Version::new(0, 0, 0));
    let remote = semver::Version::parse(&latest.version).unwrap_or(semver::Version::new(0, 0, 0));

    if remote <= current {
        return Ok(None);
    }

    let platform = match latest.platforms.get(platform_key) {
        Some(p) if !p.url.is_empty() => p,
        _ => return Ok(None),
    };

    *state.0.lock().unwrap() = Some(PendingUpdateData {
        url: platform.url.clone(),
        signature: platform.signature.clone(),
        version: latest.version.clone(),
    });

    Ok(Some(UpdateInfo {
        version: latest.version,
        current_version,
    }))
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    ready: tauri::State<'_, ReadyUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let data = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("no pending update")?;

    let platform_key = current_platform_key();
    let filtered_json = serde_json::json!({
        "version": data.version,
        "pub_date": "2025-01-01T00:00:00Z",
        "platforms": {
            platform_key: {
                "signature": data.signature,
                "url": data.url,
            }
        }
    });
    let json_bytes = serde_json::to_vec(&filtered_json).map_err(|e| format!("{e}"))?;

    let port = serve_json_once(json_bytes)?;
    let local_url: url::Url = format!("http://127.0.0.1:{}/latest.json", port)
        .parse()
        .map_err(|e| format!("{e}"))?;

    let update = app
        .updater_builder()
        .endpoints(vec![local_url])
        .map_err(|e| format!("{e}"))?
        .build()
        .map_err(|e| format!("{e}"))?
        .check()
        .await
        .map_err(|e| format!("update check failed: {e}"))?
        .ok_or("update no longer available")?;

    let mut downloaded: u64 = 0;
    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                downloaded += chunk_length as u64;
                let _ = on_event.send(DownloadEvent::Progress {
                    chunk_length,
                    downloaded,
                });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    *ready.0.lock().unwrap() = Some(ReadyUpdateData { bytes, update });

    Ok(())
}

#[tauri::command]
pub async fn apply_update(ready: tauri::State<'_, ReadyUpdate>) -> Result<(), String> {
    let data = ready
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("no downloaded update")?;

    data.update
        .install(data.bytes)
        .map_err(|e| format!("install failed: {e}"))?;

    Ok(())
}

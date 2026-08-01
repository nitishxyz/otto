use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub pid: u32,
    pub port: u16,
    pub project_path: String,
    pub project_id: String,
    pub url: String,
    pub token: Option<String>,
    pub cli_path: String,
    pub cli_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliSelectionInfo {
    pub path: String,
    pub version: String,
    pub source: String,
    pub embedded_path: String,
    pub embedded_version: String,
    pub local_path: Option<String>,
    pub local_version: Option<String>,
    pub update_available: bool,
    pub reason: String,
}

pub struct ServerState {
    pub servers: Mutex<HashMap<u32, ServerInfo>>,
    daemon_start: tokio::sync::Mutex<()>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            daemon_start: tokio::sync::Mutex::new(()),
        }
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DaemonRegistration {
    id: String,
    version: String,
    url: String,
    pid: u32,
    #[serde(rename = "startedAt")]
    _started_at: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DaemonHealth {
    #[serde(rename = "port")]
    _port: Option<u16>,
    version: Option<String>,
    pid: u32,
    daemon_id: Option<String>,
    #[serde(rename = "startedAt")]
    _started_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CliCandidate {
    path: PathBuf,
    version: String,
    source: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
enum DaemonReuseDecision {
    Reuse,
    RestartVersionMismatch,
    DiscardStale,
}

const HEALTH_TIMEOUT: Duration = Duration::from_millis(1_500);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(100);

fn otto_home_dir() -> PathBuf {
    if let Ok(otto_home) = std::env::var("OTTO_HOME") {
        let trimmed = otto_home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if cfg!(windows) {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join("AppData").join("Roaming")))
            .unwrap_or_else(std::env::temp_dir);
        return base.join("otto");
    }

    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".local")
        .join("state")
        .join("otto")
}

fn daemon_registration_path() -> PathBuf {
    otto_home_dir().join("server.json")
}

fn daemon_token_path() -> PathBuf {
    otto_home_dir().join("server-token")
}

fn platform_binary_name() -> Result<String, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let (os_name, arch_name) = match (os, arch) {
        ("macos", "aarch64") => ("darwin", "arm64"),
        ("macos", "x86_64") => ("darwin", "x64"),
        ("linux", "x86_64") => ("linux", "x64"),
        ("linux", "aarch64") => ("linux", "arm64"),
        ("windows", "x86_64") => ("windows", "x64"),
        _ => return Err(format!("Unsupported platform: {}-{}", os, arch)),
    };

    if os == "windows" {
        Ok(format!("otto-{}-{}.exe", os_name, arch_name))
    } else {
        Ok(format!("otto-{}-{}", os_name, arch_name))
    }
}

fn get_embedded_binary_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let binary_name = platform_binary_name()?;
    let mut candidates: Vec<PathBuf> = Vec::new();

    if tauri::is_dev() {
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            candidates.push(
                PathBuf::from(&manifest_dir)
                    .join("resources/binaries")
                    .join(&binary_name),
            );
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources/binaries").join(&binary_name));
        candidates.push(resource_dir.join("binaries").join(&binary_name));
        candidates.push(resource_dir.join(&binary_name));
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            candidates.push(
                parent
                    .join("../Resources/resources/binaries")
                    .join(&binary_name),
            );
            candidates.push(parent.join("../Resources/binaries").join(&binary_name));
            candidates.push(parent.join("../Resources").join(&binary_name));
            candidates.push(
                parent
                    .join("../../../resources/binaries")
                    .join(&binary_name),
            );
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(
            PathBuf::from(&manifest_dir)
                .join("resources/binaries")
                .join(&binary_name),
        );
    }

    let src_tauri_paths = [
        "apps/desktop/src-tauri/resources/binaries",
        "src-tauri/resources/binaries",
        "../src-tauri/resources/binaries",
    ];
    if let Ok(cwd) = std::env::current_dir() {
        for p in &src_tauri_paths {
            candidates.push(cwd.join(p).join(&binary_name));
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    let tried_paths: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    Err(format!(
        "Binary not found: {}. Tried paths:\n{}",
        binary_name,
        tried_paths.join("\n")
    ))
}

fn path_cli_candidates() -> Vec<PathBuf> {
    let exe_name = if cfg!(windows) { "otto.exe" } else { "otto" };
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("PATH") {
        for entry in std::env::split_paths(&path) {
            candidates.push(entry.join(exe_name));
        }
    }

    if let Some(home) = dirs::home_dir() {
        let user_cli = home.join(".local").join("bin").join(exe_name);
        if !candidates.contains(&user_cli) {
            candidates.push(user_cli);
        }
    }

    candidates
}

fn parse_cli_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .map(|part| part.trim_start_matches('v'))
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(ToString::to_string)
}

fn read_cli_version(binary: &Path) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_cli_version(&stdout).or_else(|| parse_cli_version(&stderr))
}

fn semver_cmp(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    let left = Version::parse(a).ok()?;
    let right = Version::parse(b).ok()?;
    Some(left.cmp(&right))
}

fn daemon_reuse_decision(
    registration: &DaemonRegistration,
    health: &DaemonHealth,
    selected_version: &str,
) -> DaemonReuseDecision {
    let id_matches = health
        .daemon_id
        .as_ref()
        .map(|id| id == &registration.id)
        .unwrap_or(true);
    if !id_matches || health.pid != registration.pid {
        return DaemonReuseDecision::DiscardStale;
    }

    let health_version = health.version.as_deref().unwrap_or(&registration.version);
    if registration.version == selected_version && health_version == selected_version {
        DaemonReuseDecision::Reuse
    } else {
        DaemonReuseDecision::RestartVersionMismatch
    }
}

fn cli_update_available(embedded_version: &str, local_version: Option<&str>) -> bool {
    matches!(
        local_version.and_then(|version| semver_cmp(embedded_version, version)),
        Some(std::cmp::Ordering::Greater)
    )
}

fn get_cli_candidate(paths: Vec<PathBuf>, embedded_path: &Path) -> Option<CliCandidate> {
    let canonical_embedded = embedded_path.canonicalize().ok();
    for path in paths {
        if !path.exists() {
            continue;
        }
        if let (Some(embedded), Ok(candidate)) = (&canonical_embedded, path.canonicalize()) {
            if candidate == *embedded {
                continue;
            }
        }
        if let Some(version) = read_cli_version(&path) {
            return Some(CliCandidate {
                path,
                version,
                source: "local",
            });
        }
    }
    None
}

fn embedded_cli(app: &tauri::AppHandle) -> Result<CliCandidate, String> {
    let embedded_path = get_embedded_binary_path(app)?;
    let embedded_version = read_cli_version(&embedded_path).ok_or_else(|| {
        format!(
            "Failed to read embedded CLI version: {}",
            embedded_path.display()
        )
    })?;
    Ok(CliCandidate {
        path: embedded_path.clone(),
        version: embedded_version,
        source: "embedded",
    })
}

fn select_cli(app: &tauri::AppHandle) -> Result<(CliCandidate, CliSelectionInfo), String> {
    let embedded = embedded_cli(app)?;
    let embedded_path = embedded.path.clone();
    let embedded_version = embedded.version.clone();
    let installed = get_cli_candidate(path_cli_candidates(), &embedded_path);
    let local_path = installed
        .as_ref()
        .map(|candidate| candidate.path.display().to_string());
    let local_version = installed
        .as_ref()
        .map(|candidate| candidate.version.clone());
    let update_available =
        !tauri::is_dev() && cli_update_available(&embedded_version, local_version.as_deref());
    let info = CliSelectionInfo {
        path: embedded.path.display().to_string(),
        version: embedded.version.clone(),
        source: embedded.source.to_string(),
        embedded_path: embedded_path.display().to_string(),
        embedded_version,
        local_path,
        local_version,
        update_available,
        reason: "the desktop app always runs its embedded CLI; the installed PATH CLI is only reported for updates".to_string(),
    };
    Ok((embedded, info))
}

fn read_daemon_registration() -> Option<DaemonRegistration> {
    let contents = fs::read_to_string(daemon_registration_path()).ok()?;
    serde_json::from_str(&contents).ok()
}

fn remove_daemon_registration() {
    let _ = fs::remove_file(daemon_registration_path());
}

fn read_daemon_token() -> Option<String> {
    fs::read_to_string(daemon_token_path())
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn ensure_daemon_token() -> Result<String, String> {
    if let Some(token) = read_daemon_token() {
        return Ok(token);
    }

    fs::create_dir_all(otto_home_dir())
        .map_err(|e| format!("Failed to create otto home: {}", e))?;
    let token = format!("{}{}", uuid_like(), uuid_like());
    fs::write(daemon_token_path(), format!("{}\n", token))
        .map_err(|e| format!("Failed to write daemon token: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(daemon_token_path(), fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

fn uuid_like() -> String {
    format!("{:032x}", rand::random::<u128>())
}

fn auth_headers(token: &str) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(value) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token)) {
        headers.insert(reqwest::header::AUTHORIZATION, value);
    }
    if let Ok(value) = reqwest::header::HeaderValue::from_str(token) {
        headers.insert("x-otto-server-token", value);
    }
    headers
}

async fn fetch_daemon_health(
    registration: &DaemonRegistration,
    token: &str,
) -> Option<DaemonHealth> {
    let client = reqwest::Client::builder()
        .timeout(HEALTH_TIMEOUT)
        .build()
        .ok()?;
    let response = client
        .get(format!("{}/v1/server/info", registration.url))
        .headers(auth_headers(token))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<DaemonHealth>().await.ok()
}

fn running_daemon_satisfies_embedded(running_version: &str, embedded_version: &str) -> bool {
    running_version == embedded_version
        || matches!(
            semver_cmp(running_version, embedded_version),
            Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)
        )
}

async fn reusable_running_daemon(
    app: &tauri::AppHandle,
) -> Option<(CliCandidate, DaemonRegistration)> {
    let registration = read_daemon_registration()?;
    let token = read_daemon_token()?;
    let health = fetch_daemon_health(&registration, &token).await?;
    if daemon_reuse_decision(&registration, &health, &registration.version)
        != DaemonReuseDecision::Reuse
    {
        return None;
    }

    let embedded_path = get_embedded_binary_path(app).ok()?;
    let embedded_version = read_cli_version(&embedded_path)?;
    let running_version = health.version.as_deref().unwrap_or(&registration.version);
    if !running_daemon_satisfies_embedded(running_version, &embedded_version) {
        return None;
    }

    Some((
        CliCandidate {
            path: embedded_path,
            version: running_version.to_string(),
            source: "running-daemon",
        },
        registration,
    ))
}

fn stop_process(pid: u32) -> bool {
    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

async fn stop_registered_daemon(registration: &DaemonRegistration, token: &str) {
    if let Some(health) = fetch_daemon_health(registration, token).await {
        if health.pid == registration.pid
            && health
                .daemon_id
                .as_ref()
                .map(|id| id == &registration.id)
                .unwrap_or(true)
        {
            if stop_process(registration.pid) {
                let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
                while std::time::Instant::now() < deadline {
                    tokio::time::sleep(SHUTDOWN_POLL_INTERVAL).await;
                    let still_running = fetch_daemon_health(registration, token)
                        .await
                        .map(|current| {
                            current.pid == registration.pid
                                && current
                                    .daemon_id
                                    .as_ref()
                                    .map(|id| id == &registration.id)
                                    .unwrap_or(true)
                        })
                        .unwrap_or(false);
                    if !still_running {
                        break;
                    }
                }
            }
        }
    }
    remove_daemon_registration();
}

async fn ensure_daemon(
    cli: &CliCandidate,
    project_path: &str,
) -> Result<DaemonRegistration, String> {
    let token = ensure_daemon_token()?;
    if let Some(registration) = read_daemon_registration() {
        if let Some(health) = fetch_daemon_health(&registration, &token).await {
            match daemon_reuse_decision(&registration, &health, &cli.version) {
                DaemonReuseDecision::Reuse => {
                    eprintln!(
                        "[otto] Reusing shared daemon {} for project {}",
                        registration.url, project_path
                    );
                    return Ok(registration);
                }
                DaemonReuseDecision::RestartVersionMismatch => {
                    let health_version = health.version.as_deref().unwrap_or(&registration.version);
                    eprintln!(
                        "[otto] Daemon version mismatch (running={}, registered={}, selected={}); restarting",
                        health_version, registration.version, cli.version
                    );
                    stop_registered_daemon(&registration, &token).await;
                }
                DaemonReuseDecision::DiscardStale => {
                    remove_daemon_registration();
                }
            }
        } else {
            remove_daemon_registration();
        }
    }

    start_daemon(cli, project_path).await
}

async fn start_daemon(
    cli: &CliCandidate,
    project_path: &str,
) -> Result<DaemonRegistration, String> {
    let token = ensure_daemon_token()?;
    let _ = token;
    let daemon_id = uuid_like();
    let log_path = std::env::temp_dir().join("otto-desktop-daemon.log");
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let stdout = log_file
        .as_ref()
        .and_then(|f| f.try_clone().ok())
        .map(Stdio::from)
        .unwrap_or(Stdio::null());
    let stderr = log_file.map(Stdio::from).unwrap_or(Stdio::null());
    let project_arg = project_path.to_string();

    eprintln!(
        "[otto] Starting shared daemon with {} ({}) for project {}",
        cli.path.display(),
        cli.version,
        project_path
    );

    let mut child = Command::new(&cli.path)
        .args([
            "serve",
            "--api-only",
            "--no-open",
            "--daemon-register",
            "--project",
            &project_arg,
        ])
        .env("OTTO_DAEMON_ID", &daemon_id)
        .env("PATH", augmented_path())
        .env("TERM", "xterm-256color")
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|e| format!("Failed to start daemon: {}", e))?;

    let deadline = std::time::Instant::now() + STARTUP_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Failed to check daemon process: {}", e))?
        {
            return Err(format!(
                "Otto daemon exited before registering (status={}); see {}",
                status,
                log_path.display()
            ));
        }
        if let Some(registration) = read_daemon_registration() {
            if registration.id == daemon_id {
                let token = ensure_daemon_token()?;
                if let Some(health) = fetch_daemon_health(&registration, &token).await {
                    if health.pid == registration.pid
                        && health
                            .daemon_id
                            .as_ref()
                            .map(|id| id == &registration.id)
                            .unwrap_or(true)
                        && health.version.as_deref().unwrap_or(&registration.version) == cli.version
                    {
                        return Ok(registration);
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "Timed out waiting for otto daemon to start; see {}",
        log_path.display()
    ))
}

fn augmented_path() -> String {
    let otto_bin_dir = otto_home_dir().join("bin");
    let current_path = std::env::var("PATH").unwrap_or_default();
    format!(
        "{}:/opt/homebrew/bin:/usr/local/bin:{}",
        otto_bin_dir.display(),
        current_path
    )
}

fn registration_port(registration: &DaemonRegistration) -> Result<u16, String> {
    let url =
        url::Url::parse(&registration.url).map_err(|e| format!("Invalid daemon URL: {}", e))?;
    url.port_or_known_default()
        .ok_or_else(|| "Daemon URL does not include a port".to_string())
}

#[tauri::command]
pub async fn ensure_desktop_daemon(
    state: State<'_, ServerState>,
    app: tauri::AppHandle,
) -> Result<ServerInfo, String> {
    let workspace = super::project::get_general_workspace_dir()?;
    std::fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    let _startup_guard = state.daemon_start.lock().await;
    let token = ensure_daemon_token()?;
    let cached = {
        let servers = state.servers.lock().unwrap();
        servers.values().next().cloned()
    };
    if let Some(cached) = cached {
        return Ok(cached);
    }

    let (cli, registration) = if let Some(running) = reusable_running_daemon(&app).await {
        eprintln!("[otto] Reusing healthy registered daemon without probing local CLIs");
        running
    } else {
        let cli = embedded_cli(&app)?;
        eprintln!("[otto] Starting from the embedded desktop CLI");
        let registration = ensure_daemon(&cli, &workspace.to_string_lossy()).await?;
        (cli, registration)
    };
    let port = registration_port(&registration)?;

    let info = ServerInfo {
        pid: registration.pid,
        port,
        project_path: workspace.to_string_lossy().to_string(),
        project_id: String::new(),
        url: registration.url,
        token: Some(token),
        cli_path: cli.path.display().to_string(),
        cli_version: cli.version,
    };

    state
        .servers
        .lock()
        .unwrap()
        .insert(registration.pid, info.clone());

    Ok(info)
}

#[tauri::command]
pub async fn stop_desktop_daemon(state: State<'_, ServerState>) -> Result<(), String> {
    if let Some(registration) = read_daemon_registration() {
        let token = ensure_daemon_token()?;
        stop_registered_daemon(&registration, &token).await;
    }
    state.servers.lock().unwrap().clear();
    Ok(())
}

#[tauri::command]
pub async fn get_cli_selection(app: tauri::AppHandle) -> Result<CliSelectionInfo, String> {
    let (_, info) = select_cli(&app)?;
    Ok(info)
}

fn replace_cli_binary(source: &Path, target: &Path, expected_version: &str) -> Result<(), String> {
    if target
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "Refusing to replace the symlink at {}. Update that package-managed CLI with its installer instead.",
            target.display()
        ));
    }
    let destination = target.to_path_buf();
    let parent = destination
        .parent()
        .ok_or_else(|| "Installed CLI path has no parent directory".to_string())?;
    let temp = parent.join(format!(".otto-update-{}", std::process::id()));
    let _ = fs::remove_file(&temp);
    fs::copy(source, &temp).map_err(|error| {
        format!(
            "Failed to copy the bundled CLI to {}: {}",
            destination.display(),
            error
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Failed to make the updated CLI executable: {}", error))?;
    }
    let copied_version = read_cli_version(&temp).ok_or_else(|| {
        let _ = fs::remove_file(&temp);
        "Failed to verify the copied CLI version".to_string()
    })?;
    if copied_version != expected_version {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Copied CLI version mismatch: expected {}, found {}",
            expected_version, copied_version
        ));
    }
    OpenOptions::new()
        .write(true)
        .open(&temp)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("Failed to flush the updated CLI to disk: {}", error)
        })?;

    let backup = parent.join(format!(".otto-backup-{}", std::process::id()));
    let _ = fs::remove_file(&backup);
    fs::rename(&destination, &backup).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!(
            "Failed to prepare the installed CLI at {} for replacement: {}",
            destination.display(),
            error
        )
    })?;
    if let Err(error) = fs::rename(&temp, &destination) {
        let _ = fs::rename(&backup, &destination);
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Failed to replace the installed CLI at {}: {}",
            destination.display(),
            error
        ));
    }
    let installed_version = read_cli_version(&destination);
    if installed_version.as_deref() != Some(expected_version) {
        let _ = fs::remove_file(&destination);
        let _ = fs::rename(&backup, &destination);
        return Err(format!(
            "Installed CLI verification failed: expected {}, found {}",
            expected_version,
            installed_version.as_deref().unwrap_or("unknown")
        ));
    }
    let _ = fs::remove_file(&backup);
    Ok(())
}

#[tauri::command]
pub async fn update_installed_cli(app: tauri::AppHandle) -> Result<CliSelectionInfo, String> {
    let (_, selection) = select_cli(&app)?;
    if !selection.update_available {
        return Err("The installed CLI is already the same version or newer.".to_string());
    }
    let local_path = selection
        .local_path
        .as_deref()
        .map(Path::new)
        .ok_or_else(|| "No installed Otto CLI was found on PATH.".to_string())?;
    replace_cli_binary(
        Path::new(&selection.embedded_path),
        local_path,
        &selection.embedded_version,
    )?;
    let (_, updated) = select_cli(&app)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::{
        cli_update_available, daemon_reuse_decision, parse_cli_version,
        running_daemon_satisfies_embedded, DaemonHealth, DaemonRegistration, DaemonReuseDecision,
    };
    use std::sync::Arc;
    use std::time::Duration;

    fn registration(version: &str) -> DaemonRegistration {
        DaemonRegistration {
            id: "daemon-id".to_string(),
            version: version.to_string(),
            url: "http://127.0.0.1:19000".to_string(),
            pid: 42,
            _started_at: 1,
        }
    }

    fn health(version: &str) -> DaemonHealth {
        DaemonHealth {
            _port: Some(19000),
            version: Some(version.to_string()),
            pid: 42,
            daemon_id: Some("daemon-id".to_string()),
            _started_at: 1,
        }
    }

    #[test]
    fn parses_cli_version_from_common_outputs() {
        assert_eq!(parse_cli_version("otto 1.2.3\n"), Some("1.2.3".to_string()));
        assert_eq!(parse_cli_version("1.2.3\n"), Some("1.2.3".to_string()));
        assert_eq!(
            parse_cli_version("otto v1.2.3\n"),
            Some("1.2.3".to_string())
        );
    }

    #[test]
    fn offers_cli_update_only_for_an_older_installed_release() {
        assert!(cli_update_available("1.2.0", Some("1.1.9")));
        assert!(!cli_update_available("1.2.0", Some("1.2.0")));
        assert!(!cli_update_available("1.2.0", Some("1.3.0")));
        assert!(!cli_update_available("1.2.0", None));
        assert!(!cli_update_available("dev", Some("1.1.9")));
    }

    #[test]
    fn warm_start_reuses_same_or_newer_daemon_but_not_an_older_one() {
        assert!(running_daemon_satisfies_embedded("1.2.0", "1.2.0"));
        assert!(running_daemon_satisfies_embedded("1.3.0", "1.2.0"));
        assert!(!running_daemon_satisfies_embedded("1.1.9", "1.2.0"));
        assert!(running_daemon_satisfies_embedded("dev", "dev"));
        assert!(!running_daemon_satisfies_embedded("dev", "1.2.0"));
    }

    #[tokio::test]
    async fn serializes_concurrent_daemon_start_attempts() {
        let state = Arc::new(super::ServerState::default());
        let guard = state.daemon_start.lock().await;
        let waiting_state = Arc::clone(&state);
        let mut waiter = tokio::spawn(async move {
            let _guard = waiting_state.daemon_start.lock().await;
        });

        assert!(tokio::time::timeout(Duration::from_millis(20), &mut waiter)
            .await
            .is_err());
        drop(guard);
        assert!(tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .is_ok());
    }

    #[test]
    fn reuses_daemon_only_when_pid_id_and_version_match() {
        assert_eq!(
            daemon_reuse_decision(&registration("1.2.0"), &health("1.2.0"), "1.2.0"),
            DaemonReuseDecision::Reuse
        );

        assert_eq!(
            daemon_reuse_decision(&registration("1.1.0"), &health("1.1.0"), "1.2.0"),
            DaemonReuseDecision::RestartVersionMismatch
        );

        let mut mismatched = health("1.2.0");
        mismatched.daemon_id = Some("other-id".to_string());
        assert_eq!(
            daemon_reuse_decision(&registration("1.2.0"), &mismatched, "1.2.0"),
            DaemonReuseDecision::DiscardStale
        );
    }
}

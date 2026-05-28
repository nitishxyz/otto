use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const GITHUB_CLIENT_ID: &str = "Ov23lip6QjVYxHUAeW4d";
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_AUTH_KEY: &str = "github";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
enum AuthInfo {
    #[serde(rename = "api")]
    Api { key: String },
    #[serde(rename = "wallet")]
    Wallet { secret: String },
    #[serde(rename = "oauth")]
    OAuth {
        access: String,
        refresh: String,
        expires: i64,
    },
}

fn secure_auth_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "No home directory".to_string())?;

    #[cfg(target_os = "macos")]
    {
        Ok(home
            .join("Library")
            .join("Application Support")
            .join("otto")
            .join("auth.json"))
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join("AppData").join("Roaming"));
        Ok(appdata.join("otto").join("auth.json"))
    }

    #[cfg(target_os = "linux")]
    {
        let state_home = std::env::var("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".local").join("state"));
        Ok(state_home.join("otto").join("auth.json"))
    }
}

fn read_auth() -> Result<HashMap<String, AuthInfo>, String> {
    let path = secure_auth_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_auth(auth: &HashMap<String, AuthInfo>) -> Result<(), String> {
    let path = secure_auth_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn save_github_token(token: &str) -> Result<(), String> {
    let mut auth = read_auth()?;
    auth.insert(
        GITHUB_AUTH_KEY.to_string(),
        AuthInfo::OAuth {
            access: token.to_string(),
            refresh: token.to_string(),
            expires: 0,
        },
    );
    write_auth(&auth)
}

fn load_github_token() -> Result<Option<String>, String> {
    let auth = read_auth()?;
    match auth.get(GITHUB_AUTH_KEY) {
        Some(AuthInfo::OAuth { access, .. }) => Ok(Some(access.clone())),
        Some(AuthInfo::Api { key }) => Ok(Some(key.clone())),
        _ => Ok(None),
    }
}

fn remove_github_token() -> Result<(), String> {
    let mut auth = read_auth()?;
    auth.remove(GITHUB_AUTH_KEY);
    write_auth(&auth)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub private: bool,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitHubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

#[derive(Deserialize, Clone, Debug)]
struct GitHubDeviceCodeRaw {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

impl From<GitHubDeviceCodeRaw> for DeviceCodeResponse {
    fn from(raw: GitHubDeviceCodeRaw) -> Self {
        Self {
            device_code: raw.device_code,
            user_code: raw.user_code,
            verification_uri: raw.verification_uri,
            interval: raw.interval,
            expires_in: raw.expires_in,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevicePollResult {
    pub status: String,
    pub access_token: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn github_device_code_request() -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();

    let response = client
        .post(GITHUB_DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "client_id": GITHUB_CLIENT_ID,
            "scope": "repo read:user"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub device code request failed: {}",
            response.status()
        ));
    }

    let raw: GitHubDeviceCodeRaw = response.json().await.map_err(|e| e.to_string())?;
    Ok(raw.into())
}

#[tauri::command]
pub async fn github_device_code_poll(device_code: String) -> Result<DevicePollResult, String> {
    let client = reqwest::Client::new();

    let response = client
        .post(GITHUB_ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "client_id": GITHUB_CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err("Token exchange request failed".to_string());
    }

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(token) = data.get("access_token").and_then(|v| v.as_str()) {
        save_github_token(token)?;

        return Ok(DevicePollResult {
            status: "complete".to_string(),
            access_token: Some(token.to_string()),
            error: None,
        });
    }

    if let Some(error) = data.get("error").and_then(|v| v.as_str()) {
        match error {
            "authorization_pending" | "slow_down" => {
                return Ok(DevicePollResult {
                    status: "pending".to_string(),
                    access_token: None,
                    error: None,
                });
            }
            _ => {
                return Ok(DevicePollResult {
                    status: "error".to_string(),
                    access_token: None,
                    error: Some(error.to_string()),
                });
            }
        }
    }

    Ok(DevicePollResult {
        status: "pending".to_string(),
        access_token: None,
        error: None,
    })
}

#[tauri::command]
pub async fn github_save_token(token: String) -> Result<(), String> {
    save_github_token(&token)
}

#[tauri::command]
pub async fn github_get_token() -> Result<Option<String>, String> {
    load_github_token()
}

#[tauri::command]
pub async fn github_logout() -> Result<(), String> {
    remove_github_token()
}

#[tauri::command]
pub async fn github_get_user(token: String) -> Result<GitHubUser, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "otto-desktop")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    response.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_list_repos(
    token: String,
    page: Option<u32>,
    search: Option<String>,
) -> Result<Vec<GitHubRepo>, String> {
    let client = reqwest::Client::new();
    let page_num = page.unwrap_or(1);

    let url = if let Some(ref q) = search {
        if q.trim().is_empty() {
            format!(
                "https://api.github.com/user/repos?sort=updated&per_page=30&page={}",
                page_num
            )
        } else {
            format!(
                "https://api.github.com/search/repositories?q={}+in:name+user:@me&sort=updated&per_page=30&page={}",
                urlencoding::encode(q.trim()),
                page_num
            )
        }
    } else {
        format!(
            "https://api.github.com/user/repos?sort=updated&per_page=30&page={}",
            page_num
        )
    };

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "otto-desktop")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    if search.as_ref().map_or(false, |q| !q.trim().is_empty()) {
        #[derive(Deserialize)]
        struct SearchResult {
            items: Vec<GitHubRepo>,
        }
        let result: SearchResult = response.json().await.map_err(|e| e.to_string())?;
        Ok(result.items)
    } else {
        response.json().await.map_err(|e| e.to_string())
    }
}

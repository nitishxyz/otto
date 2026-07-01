use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum AuthInfo {
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

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub agent: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tool_approval: Option<String>,
    pub theme: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    #[serde(default)]
    pub onboarding_complete: bool,
    #[serde(default)]
    pub defaults: Defaults,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OttoRouterStatus {
    pub configured: bool,
    pub public_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub configured: bool,
    #[serde(rename = "type")]
    pub auth_type: Option<String>,
    pub label: String,
    pub supports_oauth: bool,
    pub model_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub onboarding_complete: bool,
    pub ottorouter: OttoRouterStatus,
    pub providers: HashMap<String, ProviderStatus>,
    pub defaults: Defaults,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletResult {
    pub public_key: String,
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

fn global_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "No home directory".to_string())?;

    #[cfg(target_os = "macos")]
    {
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".config"));
        Ok(config_home.join("otto"))
    }

    #[cfg(target_os = "windows")]
    {
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".config"));
        Ok(config_home.join("otto"))
    }

    #[cfg(target_os = "linux")]
    {
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".config"));
        Ok(config_home.join("otto"))
    }
}

fn global_config_path() -> Result<PathBuf, String> {
    Ok(global_config_dir()?.join("config.json"))
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

fn read_config() -> Result<ConfigFile, String> {
    let path = global_config_path()?;
    if !path.exists() {
        return Ok(ConfigFile::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_config(config: &ConfigFile) -> Result<(), String> {
    let dir = global_config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn public_key_from_secret(secret_b58: &str) -> Result<String, String> {
    let bytes = bs58::decode(secret_b58)
        .into_vec()
        .map_err(|e| e.to_string())?;
    if bytes.len() != 64 {
        return Err("Invalid secret key length".to_string());
    }
    Ok(bs58::encode(&bytes[32..]).into_string())
}

static PROVIDER_META: &[(&str, &str, usize, bool)] = &[
    ("openai", "OpenAI", 40, true),
    ("anthropic", "Anthropic", 21, true),
    ("google", "Google", 26, false),
    ("openrouter", "OpenRouter", 141, false),
    ("opencode", "OpenCode Zen", 28, false),
    ("zai", "Z.AI", 7, false),
    ("zai-coding", "Z.AI Coding Plan", 8, false),
    ("moonshot", "Moonshot AI", 6, false),
];

#[tauri::command]
pub async fn get_onboarding_status() -> Result<OnboardingStatus, String> {
    let config = read_config()?;
    let auth = read_auth()?;

    let ottorouter = match auth.get("ottorouter") {
        Some(AuthInfo::Wallet { secret }) => OttoRouterStatus {
            configured: true,
            public_key: Some(public_key_from_secret(secret)?),
        },
        _ => OttoRouterStatus {
            configured: false,
            public_key: None,
        },
    };

    let mut providers = HashMap::new();
    for (id, label, model_count, supports_oauth) in PROVIDER_META {
        let provider_auth = auth.get(*id);
        providers.insert(
            id.to_string(),
            ProviderStatus {
                configured: provider_auth.is_some(),
                auth_type: provider_auth.map(|a| match a {
                    AuthInfo::Api { .. } => "api".to_string(),
                    AuthInfo::Wallet { .. } => "wallet".to_string(),
                    AuthInfo::OAuth { .. } => "oauth".to_string(),
                }),
                label: label.to_string(),
                supports_oauth: *supports_oauth,
                model_count: *model_count,
            },
        );
    }

    Ok(OnboardingStatus {
        onboarding_complete: config.onboarding_complete,
        ottorouter,
        providers,
        defaults: config.defaults,
    })
}

#[tauri::command]
pub async fn generate_wallet() -> Result<WalletResult, String> {
    let mut auth = read_auth()?;

    if let Some(AuthInfo::Wallet { secret }) = auth.get("ottorouter") {
        return Ok(WalletResult {
            public_key: public_key_from_secret(secret)?,
        });
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let mut full_secret = [0u8; 64];
    full_secret[..32].copy_from_slice(signing_key.as_bytes());
    full_secret[32..].copy_from_slice(verifying_key.as_bytes());

    let secret = bs58::encode(&full_secret).into_string();
    let public_key = bs58::encode(verifying_key.as_bytes()).into_string();

    auth.insert("ottorouter".to_string(), AuthInfo::Wallet { secret });
    write_auth(&auth)?;

    Ok(WalletResult { public_key })
}

#[tauri::command]
pub async fn add_provider(provider: String, key: String) -> Result<(), String> {
    let mut auth = read_auth()?;
    auth.insert(provider, AuthInfo::Api { key });
    write_auth(&auth)
}

#[tauri::command]
pub async fn remove_provider(provider: String) -> Result<(), String> {
    let mut auth = read_auth()?;
    auth.remove(&provider);
    write_auth(&auth)
}

#[tauri::command]
pub async fn set_defaults(
    agent: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    tool_approval: Option<String>,
    theme: Option<String>,
) -> Result<(), String> {
    let mut config = read_config()?;
    if agent.is_some() {
        config.defaults.agent = agent;
    }
    if provider.is_some() {
        config.defaults.provider = provider;
    }
    if model.is_some() {
        config.defaults.model = model;
    }
    if tool_approval.is_some() {
        config.defaults.tool_approval = tool_approval;
    }
    if let Some(theme_id) = theme {
        config.defaults.theme = Some(normalize_theme_id(&theme_id).to_string());
    }
    write_config(&config)
}

fn normalize_theme_id(theme: &str) -> &str {
    match theme {
        "dark" => "otto-dark",
        "light" => "otto-light",
        "otto-dark" | "otto-light" | "rose-pine" | "rose-pine-moon" | "rose-pine-dawn"
        | "ayu-dark" | "ayu-mirage" | "ayu-light" | "tokyo-night" | "catppuccin-mocha" | "nord"
        | "gruvbox" | "monokai" | "dracula" | "solarized-dark" => theme,
        _ => "otto-dark",
    }
}

#[tauri::command]
pub async fn complete_onboarding() -> Result<(), String> {
    let mut config = read_config()?;
    config.onboarding_complete = true;
    write_config(&config)
}

#[tauri::command]
pub async fn get_home_directory() -> Result<String, String> {
    dirs::home_dir()
        .ok_or_else(|| "No home directory".to_string())
        .map(|p| p.display().to_string())
}

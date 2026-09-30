use crate::auth::{AuthError, CodexCredentials};
use dirs::home_dir;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct AuthFile {
    auth_mode: Option<String>,
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<TokenFile>,
}

#[derive(Debug, Deserialize)]
struct TokenFile {
    access_token: Option<String>,
    account_id: Option<String>,
}

fn candidate_auth_paths() -> Vec<PathBuf> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let codex_home = codex_home.trim();
        if !codex_home.is_empty() {
            return vec![PathBuf::from(codex_home).join("auth.json")];
        }
    }

    let mut paths = Vec::new();
    if let Some(home) = home_dir() {
        paths.push(home.join(".codex/auth.json"));
        paths.push(home.join(".config/codex/auth.json"));
    }
    paths
}

pub fn read_local_credentials() -> Result<CodexCredentials, AuthError> {
    let path = candidate_auth_paths()
        .into_iter()
        .find(|path| path.is_file())
        .ok_or(AuthError::CodexAuthNotFound)?;
    read_credentials_from(&path)
}

pub fn read_credentials_from(path: &Path) -> Result<CodexCredentials, AuthError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|err| AuthError::CodexAuth(format!("unable to read {}: {err}", path.display())))?;
    let parsed: AuthFile = serde_json::from_str(&raw)
        .map_err(|_| AuthError::CodexAuth("Codex auth file is not valid JSON".to_string()))?;

    let access_token = parsed
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.access_token.as_deref())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string);

    let Some(access_token) = access_token else {
        if api_key_present(&parsed) || is_api_key_mode(parsed.auth_mode.as_deref()) {
            return Err(AuthError::CodexApiKeyAuth);
        }
        return Err(AuthError::CodexTokenNotFound);
    };

    let account_id = parsed
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.account_id.clone())
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());

    Ok(CodexCredentials {
        access_token,
        account_id,
    })
}

fn api_key_present(parsed: &AuthFile) -> bool {
    parsed
        .openai_api_key
        .as_deref()
        .map(str::trim)
        .is_some_and(|key| !key.is_empty())
}

fn is_api_key_mode(mode: Option<&str>) -> bool {
    matches!(mode.map(str::trim), Some("apikey" | "api_key" | "api-key"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_auth(body: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("agent-bar-codex-auth-{nanos}.json"));
        fs::write(&path, body).unwrap_or_else(|err| panic!("write temp auth: {err}"));
        path
    }

    #[test]
    fn reads_chatgpt_tokens_without_keeping_refresh_token() {
        let path = temp_auth(
            r#"{
                "auth_mode": "chatgpt",
                "OPENAI_API_KEY": null,
                "tokens": {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "account_id": "acc-1"
                }
            }"#,
        );
        let creds = read_credentials_from(&path).unwrap_or_else(|err| panic!("{err}"));
        let _ = fs::remove_file(&path);
        assert_eq!(creds.access_token, "access-token");
        assert_eq!(creds.account_id.as_deref(), Some("acc-1"));
    }

    #[test]
    fn api_key_without_session_is_rejected() {
        let path = temp_auth(r#"{"auth_mode":"apikey","OPENAI_API_KEY":"sk-test"}"#);
        let err = match read_credentials_from(&path) {
            Ok(_) => panic!("expected api key auth error"),
            Err(err) => err,
        };
        let _ = fs::remove_file(&path);
        assert!(matches!(err, AuthError::CodexApiKeyAuth));
    }
}

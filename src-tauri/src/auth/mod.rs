pub mod codex_token;
pub mod cursor_token;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthSource {
    /// Read access token from local Cursor state.vscdb (default).
    LocalToken,
    /// Browser cookie auth — reserved for a later release.
    Cookie,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Cursor state database not found. Open Cursor and sign in, then try again.")]
    DatabaseNotFound,
    #[error("Cursor access token not found. Open Cursor and sign in, then try again.")]
    TokenNotFound,
    #[error("Failed to read Cursor state database: {0}")]
    Database(String),
    #[error("Cookie authentication is not implemented yet")]
    CookieUnsupported,
    #[error("Codex is not signed in. Run `codex login`, then try again.")]
    CodexAuthNotFound,
    #[error("Codex access token not found. Run `codex login`, then try again.")]
    CodexTokenNotFound,
    #[error(
        "Codex is signed in with an API key. Plan quota is available after signing in with ChatGPT."
    )]
    CodexApiKeyAuth,
    #[error("Failed to read Codex auth file: {0}")]
    CodexAuth(String),
}

#[derive(Debug, Clone)]
pub struct CodexCredentials {
    pub access_token: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CursorCredentials {
    pub access_token: String,
    pub email: Option<String>,
    pub membership_type: Option<String>,
}

pub fn resolve_cursor_credentials(source: AuthSource) -> Result<CursorCredentials, AuthError> {
    match source {
        AuthSource::LocalToken => cursor_token::read_local_credentials(),
        AuthSource::Cookie => Err(AuthError::CookieUnsupported),
    }
}

pub fn resolve_codex_credentials() -> Result<CodexCredentials, AuthError> {
    codex_token::read_local_credentials()
}

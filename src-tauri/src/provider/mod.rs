pub mod codex;
pub mod cursor;
pub mod stub;

use crate::model::QuotaSnapshot;
use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum QuotaError {
    #[error("{0}")]
    Message(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Failed to parse API response: {0}")]
    Parse(String),
}

#[async_trait]
pub trait QuotaProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    async fn fetch(&self) -> Result<QuotaSnapshot, QuotaError>;
}

pub async fn fetch_all_agents() -> Vec<QuotaSnapshot> {
    let cursor = cursor::CursorProvider::new();
    let claude = stub::StubProvider::claude_code();
    let codex = codex::CodexProvider::new();
    let grok = stub::StubProvider::grok_build();

    let cursor_result = match cursor.fetch().await {
        Ok(snapshot) => snapshot,
        Err(err) => QuotaSnapshot::error_snapshot(cursor.id(), cursor.name(), err.to_string()),
    };

    let claude_result = match claude.fetch().await {
        Ok(snapshot) => snapshot,
        Err(err) => QuotaSnapshot::error_snapshot(claude.id(), claude.name(), err.to_string()),
    };

    let codex_result = match codex.fetch().await {
        Ok(snapshot) => snapshot,
        Err(err) => QuotaSnapshot::error_snapshot(codex.id(), codex.name(), err.to_string()),
    };

    let grok_result = match grok.fetch().await {
        Ok(snapshot) => snapshot,
        Err(err) => QuotaSnapshot::error_snapshot(grok.id(), grok.name(), err.to_string()),
    };

    vec![cursor_result, claude_result, codex_result, grok_result]
}

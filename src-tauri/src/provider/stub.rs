use crate::model::{AgentStatus, QuotaSnapshot, QuotaUnit};
use crate::provider::{QuotaError, QuotaProvider};
use async_trait::async_trait;

pub struct StubProvider {
    id: &'static str,
    name: &'static str,
}

impl StubProvider {
    pub fn claude_code() -> Self {
        Self {
            id: "claude-code",
            name: "Claude Code",
        }
    }

    pub fn codex() -> Self {
        Self {
            id: "codex",
            name: "Codex",
        }
    }
}

#[async_trait]
impl QuotaProvider for StubProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    async fn fetch(&self) -> Result<QuotaSnapshot, QuotaError> {
        let mut snapshot = QuotaSnapshot::coming_soon(self.id, self.name);
        snapshot.status = AgentStatus::ComingSoon;
        snapshot.unit = QuotaUnit::Requests;
        Ok(snapshot)
    }
}

use crate::auth::AuthError;
use crate::provider::QuotaError;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Auth(#[from] AuthError),
    #[error("{0}")]
    Quota(#[from] QuotaError),
    #[error("{0}")]
    Bridge(String),
}

impl From<agent_bridge_core::Error> for AppError {
    fn from(value: agent_bridge_core::Error) -> Self {
        AppError::Bridge(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

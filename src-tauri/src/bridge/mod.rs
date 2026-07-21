//! Tauri commands wrapping agent-bridge-core.

use agent_bridge_core::{
    diff, list, status, sync, DiffReport, ListReport, StatusReport, SyncKinds, SyncOptions,
    SyncReport, ToolId,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSyncRequest {
    pub from: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub only: Vec<String>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub prune: bool,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSyncResponse {
    pub ok: bool,
    pub report: SyncReport,
}

fn parse_tool(s: &str) -> Result<ToolId, AppError> {
    ToolId::from_str(s).map_err(|e| AppError::Bridge(e.to_string()))
}

#[tauri::command]
pub async fn bridge_status(tool: Option<String>) -> Result<StatusReport, AppError> {
    let tool = match tool {
        Some(t) if !t.is_empty() => Some(parse_tool(&t)?),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(move || status(tool, None))
        .await
        .map_err(|e| AppError::Bridge(format!("bridge task failed: {e}")))?
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn bridge_list(tool: String) -> Result<ListReport, AppError> {
    let tool = parse_tool(&tool)?;
    tauri::async_runtime::spawn_blocking(move || list(tool, None))
        .await
        .map_err(|e| AppError::Bridge(format!("bridge task failed: {e}")))?
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn bridge_diff(from: String, to: String) -> Result<DiffReport, AppError> {
    let from = parse_tool(&from)?;
    let to = parse_tool(&to)?;
    tauri::async_runtime::spawn_blocking(move || diff(from, to, None))
        .await
        .map_err(|e| AppError::Bridge(format!("bridge task failed: {e}")))?
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn bridge_sync(req: BridgeSyncRequest) -> Result<BridgeSyncResponse, AppError> {
    let from = parse_tool(&req.from)?;
    let to = req
        .to
        .iter()
        .map(|s| parse_tool(s))
        .collect::<Result<Vec<_>, _>>()?;
    let kinds = SyncKinds::from_list(&req.only).map_err(|e| AppError::Bridge(e.to_string()))?;
    let opts = SyncOptions {
        from,
        to,
        kinds,
        dry_run: req.dry_run,
        prune: req.prune,
        force: req.force,
        home: None,
    };
    let report = tauri::async_runtime::spawn_blocking(move || sync(&opts))
        .await
        .map_err(|e| AppError::Bridge(format!("bridge task failed: {e}")))?
        .map_err(AppError::from)?;
    Ok(BridgeSyncResponse {
        ok: report.success(),
        report,
    })
}

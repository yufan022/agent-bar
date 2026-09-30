use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuotaUnit {
    Cents,
    Requests,
    /// Remaining capacity expressed as a percentage of a rate-limit window.
    Percent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    pub short_label: String,
    pub used_percent: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Ok,
    Error,
    Unsupported,
    ComingSoon,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnDemandUsage {
    pub enabled: bool,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub unit: QuotaUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub provider_id: String,
    pub provider_name: String,
    pub status: AgentStatus,
    pub email: Option<String>,
    pub membership_type: Option<String>,
    pub display_message: Option<String>,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub unit: QuotaUnit,
    pub auto_percent_used: Option<f64>,
    pub api_percent_used: Option<f64>,
    pub total_percent_used: Option<f64>,
    pub billing_cycle_start: Option<DateTime<Utc>>,
    pub billing_cycle_end: Option<DateTime<Utc>>,
    pub days_until_reset: Option<i64>,
    pub on_demand: Option<OnDemandUsage>,
    pub windows: Vec<UsageWindow>,
    pub extra_windows: Vec<UsageWindow>,
    pub credits: Option<CreditBalance>,
    pub earned_resets: Option<i64>,
    pub tray_label: String,
    pub error: Option<String>,
    pub fetched_at: DateTime<Utc>,
}

impl QuotaSnapshot {
    pub fn coming_soon(provider_id: &str, provider_name: &str) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            provider_name: provider_name.to_string(),
            status: AgentStatus::ComingSoon,
            email: None,
            membership_type: None,
            display_message: Some("Coming soon".to_string()),
            used: None,
            limit: None,
            remaining: None,
            unit: QuotaUnit::Requests,
            auto_percent_used: None,
            api_percent_used: None,
            total_percent_used: None,
            billing_cycle_start: None,
            billing_cycle_end: None,
            days_until_reset: None,
            on_demand: None,
            windows: Vec::new(),
            extra_windows: Vec::new(),
            credits: None,
            earned_resets: None,
            tray_label: provider_name.to_string(),
            error: None,
            fetched_at: Utc::now(),
        }
    }

    pub fn error_snapshot(provider_id: &str, provider_name: &str, message: String) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            provider_name: provider_name.to_string(),
            status: AgentStatus::Error,
            email: None,
            membership_type: None,
            display_message: None,
            used: None,
            limit: None,
            remaining: None,
            unit: QuotaUnit::Requests,
            auto_percent_used: None,
            api_percent_used: None,
            total_percent_used: None,
            billing_cycle_start: None,
            billing_cycle_end: None,
            days_until_reset: None,
            on_demand: None,
            windows: Vec::new(),
            extra_windows: Vec::new(),
            credits: None,
            earned_resets: None,
            tray_label: format!("{provider_name} ?"),
            error: Some(message),
            fetched_at: Utc::now(),
        }
    }

    pub fn format_tray_label(prefix: &str, remaining: Option<f64>, unit: &QuotaUnit) -> String {
        match (remaining, unit) {
            (Some(value), QuotaUnit::Cents) => {
                format!("{prefix} ${:.1}", value / 100.0)
            }
            (Some(value), QuotaUnit::Requests) => {
                format!("{prefix} {:.0}", value)
            }
            (Some(value), QuotaUnit::Percent) => {
                format!("{prefix} {value:.0}%")
            }
            (None, _) => format!("{prefix} ?"),
        }
    }

    pub fn tooltip_detail(&self) -> String {
        if !self.windows.is_empty() {
            let parts: Vec<String> = self
                .windows
                .iter()
                .map(|window| {
                    let left = (100.0 - window.used_percent).clamp(0.0, 100.0);
                    format!("{} {left:.0}%", window.short_label)
                })
                .collect();
            return format!("{} left", parts.join(" · "));
        }
        match (self.remaining, &self.unit) {
            (Some(value), QuotaUnit::Cents) => format!("${:.2} left", value / 100.0),
            (Some(value), QuotaUnit::Requests) => format!("{value:.0} left"),
            (Some(value), QuotaUnit::Percent) => format!("{value:.0}% left"),
            (None, _) => "unknown".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsQuotaResponse {
    pub agents: Vec<QuotaSnapshot>,
    pub refreshed_at: DateTime<Utc>,
}

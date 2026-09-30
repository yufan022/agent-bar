use crate::auth::resolve_codex_credentials;
use crate::model::{AgentStatus, CreditBalance, QuotaSnapshot, QuotaUnit, UsageWindow};
use crate::provider::{QuotaError, QuotaProvider};
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

pub struct CodexProvider {
    client: Result<Client, String>,
}

impl CodexProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|err| err.to_string());
        Self { client }
    }
}

#[async_trait]
impl QuotaProvider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn name(&self) -> &'static str {
        "Codex"
    }

    async fn fetch(&self) -> Result<QuotaSnapshot, QuotaError> {
        let client = self
            .client
            .as_ref()
            .map_err(|err| QuotaError::Http(err.clone()))?;
        let credentials =
            resolve_codex_credentials().map_err(|err| QuotaError::Message(err.to_string()))?;
        let usage = get_usage(
            client,
            &credentials.access_token,
            credentials.account_id.as_deref(),
        )
        .await?;
        usage_to_snapshot(self.id(), self.name(), usage)
    }
}

#[derive(Debug, Deserialize)]
struct UsageResponse {
    email: Option<String>,
    plan_type: Option<String>,
    rate_limit: Option<RateLimitBody>,
    #[serde(default)]
    code_review_rate_limit: Option<Value>,
    #[serde(default)]
    additional_rate_limits: Option<Value>,
    credits: Option<CreditsBody>,
    spend_control: Option<SpendControlBody>,
    rate_limit_reset_credits: Option<ResetCreditsBody>,
}

#[derive(Debug, Deserialize)]
struct RateLimitBody {
    limit_reached: Option<bool>,
    primary_window: Option<WindowBody>,
    secondary_window: Option<WindowBody>,
}

#[derive(Debug, Deserialize)]
struct WindowBody {
    used_percent: f64,
    limit_window_seconds: Option<i64>,
    reset_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CreditsBody {
    has_credits: Option<bool>,
    unlimited: Option<bool>,
    balance: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SpendControlBody {
    reached: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ResetCreditsBody {
    available_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct AdditionalLimitBody {
    limit_name: Option<String>,
    metered_feature: Option<String>,
    rate_limit: Option<RateLimitBody>,
}

async fn get_usage(
    client: &Client,
    token: &str,
    account_id: Option<&str>,
) -> Result<UsageResponse, QuotaError> {
    let mut request = client
        .get(USAGE_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request
        .send()
        .await
        .map_err(|err| QuotaError::Http(err.to_string()))?;

    let status = response.status();
    if status.as_u16() == 401 {
        return Err(QuotaError::Message(
            "Codex session expired. Open Codex and sign in again.".to_string(),
        ));
    }
    if !status.is_success() {
        return Err(QuotaError::Http(format!(
            "Codex usage request failed ({status})"
        )));
    }

    response
        .json::<UsageResponse>()
        .await
        .map_err(|err| QuotaError::Parse(sanitize_error(&err.to_string())))
}

fn usage_to_snapshot(
    id: &str,
    name: &str,
    usage: UsageResponse,
) -> Result<QuotaSnapshot, QuotaError> {
    let now = Utc::now();
    let mut windows = Vec::new();
    let mut limit_reached = false;
    if let Some(rate_limit) = usage.rate_limit {
        limit_reached = rate_limit.limit_reached.unwrap_or(false);
        push_window(
            &mut windows,
            rate_limit.primary_window.as_ref(),
            "5-hour",
            "5h",
        );
        push_window(
            &mut windows,
            rate_limit.secondary_window.as_ref(),
            "Weekly",
            "7d",
        );
    }

    let mut extra_windows = Vec::new();
    if let Some(code_review) = usage
        .code_review_rate_limit
        .as_ref()
        .and_then(|value| serde_json::from_value::<RateLimitBody>(value.clone()).ok())
    {
        push_window(
            &mut extra_windows,
            code_review.primary_window.as_ref(),
            "Code review",
            "review",
        );
    }
    if let Some(additional) = usage.additional_rate_limits.as_ref() {
        let parsed = serde_json::from_value::<Vec<AdditionalLimitBody>>(additional.clone()).ok();
        if let Some(items) = parsed {
            for item in items {
                let label = item
                    .limit_name
                    .or(item.metered_feature)
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| "Other".to_string());
                let short = short_extra_label(&label);
                push_window(
                    &mut extra_windows,
                    item.rate_limit
                        .as_ref()
                        .and_then(|limit| limit.primary_window.as_ref()),
                    &label,
                    &short,
                );
            }
        }
    }

    let credits = usage
        .credits
        .as_ref()
        .map(credit_balance)
        .filter(credits_visible);
    let earned_resets = usage
        .rate_limit_reset_credits
        .and_then(|credits| credits.available_count)
        .filter(|count| *count > 0);

    if windows.is_empty() && extra_windows.is_empty() && credits.is_none() {
        return Err(QuotaError::Message(
            "No usage data returned by Codex".to_string(),
        ));
    }

    let tighter = windows.iter().max_by(|left, right| {
        left.used_percent
            .partial_cmp(&right.used_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let used = tighter.map(|window| window.used_percent);
    let remaining = used.map(|value| (100.0 - value).clamp(0.0, 100.0));
    let resets_at = tighter.and_then(|window| window.resets_at);

    let mut messages = Vec::new();
    if limit_reached {
        messages.push("Rate limit reached".to_string());
    }
    if usage
        .spend_control
        .as_ref()
        .and_then(|spend| spend.reached)
        .unwrap_or(false)
    {
        messages.push("Spend limit reached".to_string());
    }

    let mut snapshot = QuotaSnapshot {
        provider_id: id.to_string(),
        provider_name: name.to_string(),
        status: AgentStatus::Ok,
        email: usage.email.filter(|email| !email.trim().is_empty()),
        membership_type: usage.plan_type.filter(|plan| !plan.trim().is_empty()),
        display_message: if messages.is_empty() {
            None
        } else {
            Some(messages.join(" · "))
        },
        used,
        limit: used.map(|_| 100.0),
        remaining,
        unit: QuotaUnit::Percent,
        auto_percent_used: None,
        api_percent_used: None,
        total_percent_used: used,
        billing_cycle_start: None,
        billing_cycle_end: resets_at,
        days_until_reset: resets_at.map(|end| (end - now).num_days().max(0)),
        on_demand: None,
        windows,
        extra_windows,
        credits,
        earned_resets,
        tray_label: format!("{name} ?"),
        error: None,
        fetched_at: now,
    };
    snapshot.tray_label =
        QuotaSnapshot::format_tray_label(name, snapshot.remaining, &snapshot.unit);
    Ok(snapshot)
}

fn push_window(
    out: &mut Vec<UsageWindow>,
    body: Option<&WindowBody>,
    fallback_label: &str,
    fallback_short: &str,
) {
    let Some(body) = body else {
        return;
    };
    let (label, short_label) =
        window_labels(body.limit_window_seconds, fallback_label, fallback_short);
    out.push(UsageWindow {
        label,
        short_label,
        used_percent: body.used_percent.clamp(0.0, 100.0),
        resets_at: body.reset_at.and_then(unix_seconds),
    });
}

fn window_labels(
    seconds: Option<i64>,
    fallback_label: &str,
    fallback_short: &str,
) -> (String, String) {
    match seconds {
        Some(18_000) => ("5-hour".to_string(), "5h".to_string()),
        Some(secs) if secs > 0 && secs % 86_400 == 0 => {
            let days = secs / 86_400;
            if days == 7 {
                ("Weekly".to_string(), "7d".to_string())
            } else {
                (format!("{days}-day"), format!("{days}d"))
            }
        }
        Some(secs) if secs > 0 && secs % 3_600 == 0 => {
            let hours = secs / 3_600;
            (format!("{hours}-hour"), format!("{hours}h"))
        }
        _ => (fallback_label.to_string(), fallback_short.to_string()),
    }
}

fn short_extra_label(label: &str) -> String {
    let compact: String = label
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    if compact.is_empty() {
        "other".to_string()
    } else {
        compact.chars().take(8).collect()
    }
}

fn credits_visible(credits: &CreditBalance) -> bool {
    if credits.unlimited || credits.has_credits {
        return true;
    }
    match credits.balance.as_deref() {
        Some(text) => text.parse::<f64>().ok().is_some_and(|amount| amount > 0.0),
        None => false,
    }
}

fn credit_balance(body: &CreditsBody) -> CreditBalance {
    CreditBalance {
        has_credits: body.has_credits.unwrap_or(false),
        unlimited: body.unlimited.unwrap_or(false),
        balance: balance_string(body.balance.as_ref()),
    }
}

fn balance_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn unix_seconds(secs: i64) -> Option<DateTime<Utc>> {
    if secs <= 0 {
        return None;
    }
    Utc.timestamp_opt(secs, 0).single()
}

fn sanitize_error(message: &str) -> String {
    let mut out = message.to_string();
    if let Some(idx) = out.find("Bearer ") {
        out.replace_range(idx.., "Bearer [redacted]");
    }
    if out.len() > 280 {
        out.truncate(277);
        out.push_str("...");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_primary_and_weekly_windows() {
        let raw = r#"{
            "email": "user@example.com",
            "plan_type": "plus",
            "rate_limit": {
                "allowed": true,
                "limit_reached": false,
                "primary_window": {
                    "used_percent": 52,
                    "limit_window_seconds": 18000,
                    "reset_after_seconds": 9068,
                    "reset_at": 1790767437
                },
                "secondary_window": {
                    "used_percent": 8,
                    "limit_window_seconds": 604800,
                    "reset_after_seconds": 595868,
                    "reset_at": 1791354237
                }
            },
            "credits": {
                "has_credits": false,
                "unlimited": false,
                "balance": "0"
            }
        }"#;
        let usage: UsageResponse =
            serde_json::from_str(raw).unwrap_or_else(|err| panic!("parse fixture: {err}"));
        let snapshot =
            usage_to_snapshot("codex", "Codex", usage).unwrap_or_else(|err| panic!("{err}"));
        assert_eq!(snapshot.membership_type.as_deref(), Some("plus"));
        assert_eq!(snapshot.email.as_deref(), Some("user@example.com"));
        assert_eq!(snapshot.unit, QuotaUnit::Percent);
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].short_label, "5h");
        assert_eq!(snapshot.windows[0].used_percent, 52.0);
        assert_eq!(snapshot.windows[1].short_label, "7d");
        assert_eq!(snapshot.windows[1].used_percent, 8.0);
        assert_eq!(snapshot.remaining, Some(48.0));
        assert_eq!(snapshot.total_percent_used, Some(52.0));
        assert_eq!(snapshot.tooltip_detail(), "5h 48% · 7d 92% left");
        assert!(snapshot.credits.is_none());
    }

    #[test]
    fn empty_payload_is_an_error() {
        let usage: UsageResponse =
            serde_json::from_str("{}").unwrap_or_else(|err| panic!("parse fixture: {err}"));
        let err = match usage_to_snapshot("codex", "Codex", usage) {
            Ok(_) => panic!("expected missing usage error"),
            Err(err) => err,
        };
        assert!(matches!(err, QuotaError::Message(_)));
    }
}

use crate::auth::{resolve_cursor_credentials, AuthSource};
use crate::model::{
    AgentStatus, OnDemandUsage, QuotaSnapshot, QuotaUnit,
};
use crate::provider::{QuotaError, QuotaProvider};
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;

const API_BASE: &str = "https://api2.cursor.sh";
const INCLUDED_MODEL_KEY: &str = "gpt-4";

pub struct CursorProvider {
    client: Client,
    auth_source: AuthSource,
}

impl CursorProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            auth_source: AuthSource::LocalToken,
        }
    }
}

#[async_trait]
impl QuotaProvider for CursorProvider {
    fn id(&self) -> &'static str {
        "cursor"
    }

    fn name(&self) -> &'static str {
        "Cursor"
    }

    async fn fetch(&self) -> Result<QuotaSnapshot, QuotaError> {
        let credentials = resolve_cursor_credentials(self.auth_source.clone())
            .map_err(|e| QuotaError::Message(e.to_string()))?;

        let period = self
            .get_current_period_usage(&credentials.access_token)
            .await;
        let auth_usage = self.get_auth_usage(&credentials.access_token).await;
        let summary = self.get_usage_summary(&credentials.access_token).await;

        merge_cursor_usage(
            self.name(),
            self.id(),
            credentials.email,
            credentials.membership_type,
            period,
            auth_usage,
            summary,
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeriodUsageResponse {
    billing_cycle_start: Option<Value>,
    billing_cycle_end: Option<Value>,
    plan_usage: Option<PlanUsage>,
    spend_limit_usage: Option<SpendLimitUsage>,
    display_message: Option<String>,
    membership_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanUsage {
    total_spend: Option<f64>,
    included_spend: Option<f64>,
    remaining: Option<f64>,
    limit: Option<f64>,
    auto_percent_used: Option<f64>,
    api_percent_used: Option<f64>,
    total_percent_used: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpendLimitUsage {
    total_spend: Option<f64>,
    individual_limit: Option<f64>,
    individual_used: Option<f64>,
    individual_remaining: Option<f64>,
    pooled_limit: Option<f64>,
    pooled_used: Option<f64>,
    pooled_remaining: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelBucket {
    num_requests: Option<f64>,
    max_request_usage: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageSummaryResponse {
    billing_cycle_start: Option<String>,
    billing_cycle_end: Option<String>,
    membership_type: Option<String>,
    individual_usage: Option<IndividualUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndividualUsage {
    plan: Option<SummaryPlan>,
    on_demand: Option<SummaryOnDemand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryPlan {
    enabled: Option<bool>,
    used: Option<f64>,
    limit: Option<f64>,
    remaining: Option<f64>,
    auto_percent_used: Option<f64>,
    api_percent_used: Option<f64>,
    total_percent_used: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryOnDemand {
    enabled: Option<bool>,
    used: Option<f64>,
    limit: Option<f64>,
    remaining: Option<f64>,
}

impl CursorProvider {
    async fn get_current_period_usage(
        &self,
        token: &str,
    ) -> Result<PeriodUsageResponse, QuotaError> {
        let url = format!("{API_BASE}/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| QuotaError::Http(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| String::new());
            return Err(QuotaError::Http(format!(
                "GetCurrentPeriodUsage failed ({status}): {body}"
            )));
        }

        response
            .json::<PeriodUsageResponse>()
            .await
            .map_err(|e| QuotaError::Parse(e.to_string()))
    }

    async fn get_auth_usage(&self, token: &str) -> Result<Value, QuotaError> {
        let url = format!("{API_BASE}/auth/usage");
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| QuotaError::Http(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| String::new());
            return Err(QuotaError::Http(format!(
                "/auth/usage failed ({status}): {body}"
            )));
        }

        response
            .json::<Value>()
            .await
            .map_err(|e| QuotaError::Parse(e.to_string()))
    }

    async fn get_usage_summary(&self, token: &str) -> Result<UsageSummaryResponse, QuotaError> {
        let url = format!("{API_BASE}/api/usage/summary");
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| QuotaError::Http(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| String::new());
            return Err(QuotaError::Http(format!(
                "/api/usage/summary failed ({status}): {body}"
            )));
        }

        response
            .json::<UsageSummaryResponse>()
            .await
            .map_err(|e| QuotaError::Parse(e.to_string()))
    }
}

fn merge_cursor_usage(
    name: &str,
    id: &str,
    email: Option<String>,
    local_membership: Option<String>,
    period: Result<PeriodUsageResponse, QuotaError>,
    auth_usage: Result<Value, QuotaError>,
    summary: Result<UsageSummaryResponse, QuotaError>,
) -> Result<QuotaSnapshot, QuotaError> {
    let now = Utc::now();
    let mut snapshot = QuotaSnapshot {
        provider_id: id.to_string(),
        provider_name: name.to_string(),
        status: AgentStatus::Ok,
        email,
        membership_type: local_membership,
        display_message: None,
        used: None,
        limit: None,
        remaining: None,
        unit: QuotaUnit::Cents,
        auto_percent_used: None,
        api_percent_used: None,
        total_percent_used: None,
        billing_cycle_start: None,
        billing_cycle_end: None,
        days_until_reset: None,
        on_demand: None,
        tray_label: format!("{name} ?"),
        error: None,
        fetched_at: now,
    };

    let mut errors: Vec<String> = Vec::new();
    let mut has_plan_usage = false;

    if let Ok(period) = period {
        if let Some(membership) = period.membership_type {
            snapshot.membership_type = Some(membership);
        }
        snapshot.display_message = period.display_message;
        snapshot.billing_cycle_start = parse_cycle_value(period.billing_cycle_start.as_ref());
        snapshot.billing_cycle_end = parse_cycle_value(period.billing_cycle_end.as_ref());

        if let Some(plan) = period.plan_usage {
            if plan.limit.unwrap_or(0.0) > 0.0 || plan.remaining.is_some() {
                has_plan_usage = true;
                snapshot.unit = QuotaUnit::Cents;
                let used = plan
                    .included_spend
                    .or(plan.total_spend)
                    .or_else(|| match (plan.limit, plan.remaining) {
                        (Some(limit), Some(remaining)) => Some((limit - remaining).max(0.0)),
                        _ => None,
                    });
                snapshot.used = used;
                snapshot.limit = plan.limit;
                snapshot.remaining = plan.remaining.or_else(|| match (plan.limit, used) {
                    (Some(limit), Some(u)) => Some((limit - u).max(0.0)),
                    _ => None,
                });
                snapshot.auto_percent_used = plan.auto_percent_used;
                snapshot.api_percent_used = plan.api_percent_used;
                snapshot.total_percent_used = plan.total_percent_used;
            }
        }

        if let Some(spend) = period.spend_limit_usage {
            let used = spend.individual_used.or(spend.pooled_used).or(spend.total_spend);
            let limit = spend.individual_limit.or(spend.pooled_limit);
            let remaining = spend
                .individual_remaining
                .or(spend.pooled_remaining);
            if used.is_some() || limit.is_some() {
                snapshot.on_demand = Some(OnDemandUsage {
                    enabled: true,
                    used,
                    limit,
                    remaining,
                    unit: QuotaUnit::Cents,
                });
            }
        }
    } else if let Err(e) = period {
        errors.push(e.to_string());
    }

    if !has_plan_usage {
        if let Ok(usage) = auth_usage {
            if let Some((used, limit)) = extract_request_bucket(&usage) {
                snapshot.unit = QuotaUnit::Requests;
                snapshot.used = Some(used);
                snapshot.limit = limit;
                snapshot.remaining = limit.map(|max| (max - used).max(0.0));
                if let Some(start) = usage.get("startOfMonth").and_then(|v| v.as_str()) {
                    snapshot.billing_cycle_start = parse_iso_datetime(start);
                }
                has_plan_usage = snapshot.limit.is_some() || snapshot.used.is_some();
            }
        } else if let Err(e) = auth_usage {
            errors.push(e.to_string());
        }
    }

    if let Ok(summary) = summary {
        if snapshot.membership_type.is_none() {
            snapshot.membership_type = summary.membership_type;
        }
        if snapshot.billing_cycle_start.is_none() {
            snapshot.billing_cycle_start = summary
                .billing_cycle_start
                .as_deref()
                .and_then(parse_iso_datetime);
        }
        if snapshot.billing_cycle_end.is_none() {
            snapshot.billing_cycle_end = summary
                .billing_cycle_end
                .as_deref()
                .and_then(parse_iso_datetime);
        }

        if let Some(individual) = summary.individual_usage {
            if let Some(plan) = individual.plan {
                if !has_plan_usage && plan.enabled.unwrap_or(true) {
                    snapshot.unit = QuotaUnit::Requests;
                    snapshot.used = plan.used;
                    snapshot.limit = plan.limit;
                    snapshot.remaining = plan.remaining.or_else(|| match (plan.limit, plan.used) {
                        (Some(limit), Some(used)) => Some((limit - used).max(0.0)),
                        _ => None,
                    });
                    has_plan_usage = true;
                }
                if snapshot.auto_percent_used.is_none() {
                    snapshot.auto_percent_used = plan.auto_percent_used;
                }
                if snapshot.api_percent_used.is_none() {
                    snapshot.api_percent_used = plan.api_percent_used;
                }
                if snapshot.total_percent_used.is_none() {
                    snapshot.total_percent_used = plan.total_percent_used;
                }
            }

            if snapshot.on_demand.is_none() {
                if let Some(on_demand) = individual.on_demand {
                    if on_demand.enabled.unwrap_or(false)
                        || on_demand.used.is_some()
                        || on_demand.limit.is_some()
                    {
                        snapshot.on_demand = Some(OnDemandUsage {
                            enabled: on_demand.enabled.unwrap_or(true),
                            used: on_demand.used,
                            limit: on_demand.limit,
                            remaining: on_demand.remaining,
                            unit: QuotaUnit::Cents,
                        });
                    }
                }
            }
        }
    } else if let Err(e) = summary {
        errors.push(e.to_string());
    }

    if let Some(end) = snapshot.billing_cycle_end {
        let days = (end - now).num_days().max(0);
        snapshot.days_until_reset = Some(days);
    }

    if snapshot.total_percent_used.is_none() {
        if let (Some(used), Some(limit)) = (snapshot.used, snapshot.limit) {
            if limit > 0.0 {
                snapshot.total_percent_used = Some((used / limit) * 100.0);
            }
        }
    }

    snapshot.tray_label =
        QuotaSnapshot::format_tray_label(name, snapshot.remaining, &snapshot.unit);

    if !has_plan_usage && snapshot.on_demand.is_none() {
        let message = if errors.is_empty() {
            "No usage data returned by Cursor API".to_string()
        } else {
            sanitize_error(&errors.join("; "))
        };
        return Err(QuotaError::Message(message));
    }

    if !errors.is_empty() && !has_plan_usage {
        snapshot.status = AgentStatus::Error;
        snapshot.error = Some(sanitize_error(&errors.join("; ")));
    }

    Ok(snapshot)
}

fn extract_request_bucket(usage: &Value) -> Option<(f64, Option<f64>)> {
    if let Some(bucket) = usage.get(INCLUDED_MODEL_KEY) {
        let parsed: ModelBucket = serde_json::from_value(bucket.clone()).ok()?;
        let used = parsed.num_requests.unwrap_or(0.0);
        return Some((used, parsed.max_request_usage));
    }

    // Fall back to the first object that looks like a request bucket.
    if let Some(map) = usage.as_object() {
        for (key, value) in map {
            if key == "startOfMonth" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_value::<ModelBucket>(value.clone()) {
                if parsed.num_requests.is_some() || parsed.max_request_usage.is_some() {
                    return Some((
                        parsed.num_requests.unwrap_or(0.0),
                        parsed.max_request_usage,
                    ));
                }
            }
        }
    }
    None
}

fn parse_cycle_value(value: Option<&Value>) -> Option<DateTime<Utc>> {
    match value? {
        Value::String(s) => {
            if let Ok(ms) = s.parse::<i64>() {
                return Utc.timestamp_millis_opt(ms).single();
            }
            parse_iso_datetime(s)
        }
        Value::Number(n) => {
            let ms = n.as_i64().or_else(|| n.as_f64().map(|f| f as i64))?;
            Utc.timestamp_millis_opt(ms).single()
        }
        _ => None,
    }
}

fn parse_iso_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn sanitize_error(message: &str) -> String {
    // Avoid leaking bearer tokens if they ever appear in error text.
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
    use crate::model::{QuotaSnapshot, QuotaUnit};

    #[test]
    fn tray_label_formats_cents_and_requests() {
        assert_eq!(
            QuotaSnapshot::format_tray_label("Cursor", Some(1234.0), &QuotaUnit::Cents),
            "Cursor $12.3"
        );
        assert_eq!(
            QuotaSnapshot::format_tray_label("Cursor", Some(42.0), &QuotaUnit::Requests),
            "Cursor 42"
        );
    }

    #[test]
    fn sanitize_redacts_bearer_prefix() {
        let cleaned = sanitize_error("HTTP 401 Bearer secret-token-value remaining");
        assert!(cleaned.contains("Bearer [redacted]"));
        assert!(!cleaned.contains("secret-token-value"));
    }
}

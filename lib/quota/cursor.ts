import { readCursorCredentials } from "./auth.ts";
import {
  blankSnapshot,
  formatTrayLabel,
  sanitizeError,
  type OnDemandUsage,
  type QuotaSnapshot,
} from "./model.ts";

const API_BASE = "https://api2.cursor.sh";
const INCLUDED_MODEL_KEY = "gpt-4";

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export async function fetchCursor(): Promise<QuotaSnapshot> {
  const credentials = readCursorCredentials();
  const [period, authUsage, summary] = await Promise.all([
    capture(() => getCurrentPeriodUsage(credentials.accessToken)),
    capture(() => getAuthUsage(credentials.accessToken)),
    capture(() => getUsageSummary(credentials.accessToken)),
  ]);
  return mergeCursorUsage(
    "Cursor",
    "cursor",
    credentials.email,
    credentials.membershipType,
    period,
    authUsage,
    summary,
  );
}

async function capture<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getCurrentPeriodUsage(token: string): Promise<Record<string, unknown>> {
  return postJson(`${API_BASE}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, token, {});
}

async function getAuthUsage(token: string): Promise<Record<string, unknown>> {
  return getJson(`${API_BASE}/auth/usage`, token, "/auth/usage");
}

async function getUsageSummary(token: string): Promise<Record<string, unknown>> {
  return getJson(`${API_BASE}/api/usage/summary`, token, "/api/usage/summary");
}

async function postJson(url: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new QuotaError(`HTTP error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuotaError(`HTTP error: GetCurrentPeriodUsage failed (${response.status}): ${text}`);
  }
  return readJson(response);
}

async function getJson(url: string, token: string, label: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new QuotaError(`HTTP error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuotaError(`HTTP error: ${label} failed (${response.status}): ${text}`);
  }
  return readJson(response);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new QuotaError(
      `Failed to parse API response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function mergeCursorUsage(
  name: string,
  id: string,
  email: string | null,
  localMembership: string | null,
  period: { ok: true; value: Record<string, unknown> } | { ok: false; error: string },
  authUsage: { ok: true; value: Record<string, unknown> } | { ok: false; error: string },
  summary: { ok: true; value: Record<string, unknown> } | { ok: false; error: string },
): QuotaSnapshot {
  const now = new Date();
  const snapshot = blankSnapshot(id, name, "cents");
  snapshot.email = email;
  snapshot.membershipType = localMembership;
  snapshot.fetchedAt = now.toISOString();
  const errors: string[] = [];
  let hasPlanUsage = false;

  if (period.ok) {
    const membership = stringValue(period.value.membershipType);
    if (membership) {
      snapshot.membershipType = membership;
    }
    snapshot.displayMessage = stringValue(period.value.displayMessage);
    snapshot.billingCycleStart = parseCycleValue(period.value.billingCycleStart);
    snapshot.billingCycleEnd = parseCycleValue(period.value.billingCycleEnd);
    const plan = recordValue(period.value.planUsage);
    if (plan && ((numberValue(plan.limit) ?? 0) > 0 || numberValue(plan.remaining) !== null)) {
      hasPlanUsage = true;
      snapshot.unit = "cents";
      const used =
        numberValue(plan.includedSpend) ??
        numberValue(plan.totalSpend) ??
        difference(numberValue(plan.limit), numberValue(plan.remaining));
      snapshot.used = used;
      snapshot.limit = numberValue(plan.limit);
      snapshot.remaining =
        numberValue(plan.remaining) ?? difference(numberValue(plan.limit), used);
      snapshot.autoPercentUsed = numberValue(plan.autoPercentUsed);
      snapshot.apiPercentUsed = numberValue(plan.apiPercentUsed);
      snapshot.totalPercentUsed = numberValue(plan.totalPercentUsed);
    }
    const spend = recordValue(period.value.spendLimitUsage);
    if (spend) {
      const used =
        numberValue(spend.individualUsed) ??
        numberValue(spend.pooledUsed) ??
        numberValue(spend.totalSpend);
      const limit = numberValue(spend.individualLimit) ?? numberValue(spend.pooledLimit);
      const remaining =
        numberValue(spend.individualRemaining) ?? numberValue(spend.pooledRemaining);
      if (used !== null || limit !== null) {
        snapshot.onDemand = {
          enabled: true,
          used,
          limit,
          remaining,
          unit: "cents",
        };
      }
    }
  } else {
    errors.push(period.error);
  }

  if (!hasPlanUsage) {
    if (authUsage.ok) {
      const bucket = extractRequestBucket(authUsage.value);
      if (bucket) {
        snapshot.unit = "requests";
        snapshot.used = bucket.used;
        snapshot.limit = bucket.limit;
        snapshot.remaining = bucket.limit === null ? null : Math.max(0, bucket.limit - bucket.used);
        const start = stringValue(authUsage.value.startOfMonth);
        if (start) {
          snapshot.billingCycleStart = parseIso(start);
        }
        hasPlanUsage = snapshot.limit !== null || snapshot.used !== null;
      }
    } else {
      errors.push(authUsage.error);
    }
  }

  if (summary.ok) {
    if (!snapshot.membershipType) {
      snapshot.membershipType = stringValue(summary.value.membershipType);
    }
    if (!snapshot.billingCycleStart) {
      const start = stringValue(summary.value.billingCycleStart);
      snapshot.billingCycleStart = start ? parseIso(start) : null;
    }
    if (!snapshot.billingCycleEnd) {
      const end = stringValue(summary.value.billingCycleEnd);
      snapshot.billingCycleEnd = end ? parseIso(end) : null;
    }
    const individual = recordValue(summary.value.individualUsage);
    if (individual) {
      const plan = recordValue(individual.plan);
      if (plan) {
        if (!hasPlanUsage && (booleanValue(plan.enabled) ?? true)) {
          snapshot.unit = "requests";
          snapshot.used = numberValue(plan.used);
          snapshot.limit = numberValue(plan.limit);
          snapshot.remaining =
            numberValue(plan.remaining) ??
            difference(numberValue(plan.limit), numberValue(plan.used));
          hasPlanUsage = true;
        }
        if (snapshot.autoPercentUsed === null) {
          snapshot.autoPercentUsed = numberValue(plan.autoPercentUsed);
        }
        if (snapshot.apiPercentUsed === null) {
          snapshot.apiPercentUsed = numberValue(plan.apiPercentUsed);
        }
        if (snapshot.totalPercentUsed === null) {
          snapshot.totalPercentUsed = numberValue(plan.totalPercentUsed);
        }
      }
      if (!snapshot.onDemand) {
        const onDemand = recordValue(individual.onDemand);
        if (
          onDemand &&
          ((booleanValue(onDemand.enabled) ?? false) ||
            numberValue(onDemand.used) !== null ||
            numberValue(onDemand.limit) !== null)
        ) {
          const demand: OnDemandUsage = {
            enabled: booleanValue(onDemand.enabled) ?? true,
            used: numberValue(onDemand.used),
            limit: numberValue(onDemand.limit),
            remaining: numberValue(onDemand.remaining),
            unit: "cents",
          };
          snapshot.onDemand = demand;
        }
      }
    }
  } else {
    errors.push(summary.error);
  }

  if (snapshot.billingCycleEnd) {
    snapshot.daysUntilReset = daysUntil(snapshot.billingCycleEnd, now);
  }
  if (
    snapshot.totalPercentUsed === null &&
    snapshot.used !== null &&
    snapshot.limit !== null &&
    snapshot.limit > 0
  ) {
    snapshot.totalPercentUsed = (snapshot.used / snapshot.limit) * 100;
  }
  snapshot.trayLabel = formatTrayLabel(name, snapshot.remaining, snapshot.unit);

  if (!hasPlanUsage && !snapshot.onDemand) {
    const message =
      errors.length === 0 ? "No usage data returned by Cursor API" : sanitizeError(errors.join("; "));
    throw new QuotaError(message);
  }
  if (errors.length > 0 && !hasPlanUsage) {
    snapshot.status = "error";
    snapshot.error = sanitizeError(errors.join("; "));
  }
  return snapshot;
}

function extractRequestBucket(
  usage: Record<string, unknown>,
): { used: number; limit: number | null } | null {
  const preferred = recordValue(usage[INCLUDED_MODEL_KEY]);
  if (preferred) {
    return {
      used: numberValue(preferred.numRequests) ?? 0,
      limit: numberValue(preferred.maxRequestUsage),
    };
  }
  for (const [key, value] of Object.entries(usage)) {
    if (key === "startOfMonth") {
      continue;
    }
    const bucket = recordValue(value);
    if (!bucket) {
      continue;
    }
    if (bucket.numRequests !== undefined || bucket.maxRequestUsage !== undefined) {
      return {
        used: numberValue(bucket.numRequests) ?? 0,
        limit: numberValue(bucket.maxRequestUsage),
      };
    }
  }
  return null;
}

function parseCycleValue(value: unknown): string | null {
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value)) {
      return millisToIso(Number(value));
    }
    return parseIso(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return millisToIso(Math.trunc(value));
  }
  return null;
}

function parseIso(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function millisToIso(millis: number): string | null {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function daysUntil(iso: string, now: Date): number {
  const end = Date.parse(iso);
  if (Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, Math.trunc((end - now.getTime()) / 86_400_000));
}

function difference(limit: number | null, used: number | null): number | null {
  if (limit === null || used === null) {
    return null;
  }
  return Math.max(0, limit - used);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

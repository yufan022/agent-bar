import { readCodexCredentials } from "./auth.ts";
import {
  blankSnapshot,
  formatTrayLabel,
  sanitizeError,
  type CreditBalance,
  type QuotaSnapshot,
  type UsageWindow,
} from "./model.ts";
import { QuotaError } from "./cursor.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

interface WindowBody {
  usedPercent: number;
  limitWindowSeconds: number | null;
  resetAt: number | null;
}

export async function fetchCodex(): Promise<QuotaSnapshot> {
  const credentials = readCodexCredentials();
  const usage = await getUsage(credentials.accessToken, credentials.accountId);
  return usageToSnapshot("codex", "Codex", usage);
}

async function getUsage(token: string, accountId: string | null): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new QuotaError(`HTTP error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 401) {
    throw new QuotaError("Codex session expired. Open Codex and sign in again.");
  }
  if (!response.ok) {
    throw new QuotaError(`HTTP error: Codex usage request failed (${response.status})`);
  }
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new QuotaError(
      `Failed to parse API response: ${sanitizeError(error instanceof Error ? error.message : String(error))}`,
    );
  }
}

export function usageToSnapshot(
  id: string,
  name: string,
  usage: Record<string, unknown>,
): QuotaSnapshot {
  const now = new Date();
  const windows: UsageWindow[] = [];
  let limitReached = false;
  const rateLimit = recordValue(usage.rate_limit);
  if (rateLimit) {
    limitReached = booleanValue(rateLimit.limit_reached) ?? false;
    pushWindow(windows, parseWindow(rateLimit.primary_window), "5-hour", "5h");
    pushWindow(windows, parseWindow(rateLimit.secondary_window), "Weekly", "7d");
  }

  const extraWindows: UsageWindow[] = [];
  const codeReview = parseRateLimit(usage.code_review_rate_limit);
  if (codeReview) {
    pushWindow(extraWindows, codeReview.primary, "Code review", "review");
  }
  if (Array.isArray(usage.additional_rate_limits)) {
    for (const item of usage.additional_rate_limits) {
      const record = recordValue(item);
      if (!record) {
        continue;
      }
      const label =
        nonEmpty(stringValue(record.limit_name)) ??
        nonEmpty(stringValue(record.metered_feature)) ??
        "Other";
      const parsed = parseRateLimit(record.rate_limit);
      pushWindow(extraWindows, parsed?.primary ?? null, label, shortExtraLabel(label));
    }
  }

  const credits = creditBalance(recordValue(usage.credits));
  const visibleCredits = credits && creditsVisible(credits) ? credits : null;
  const earned = numberValue(recordValue(usage.rate_limit_reset_credits)?.available_count);
  const earnedResets = earned !== null && earned > 0 ? Math.trunc(earned) : null;

  if (windows.length === 0 && extraWindows.length === 0 && !visibleCredits) {
    throw new QuotaError("No usage data returned by Codex");
  }

  const tighter = windows.reduce<UsageWindow | null>((best, window) => {
    if (!best || window.usedPercent > best.usedPercent) {
      return window;
    }
    return best;
  }, null);
  const used = tighter ? tighter.usedPercent : null;
  const remaining = used === null ? null : Math.min(100, Math.max(0, 100 - used));
  const resetsAt = tighter?.resetsAt ?? null;
  const messages: string[] = [];
  if (limitReached) {
    messages.push("Rate limit reached");
  }
  if (booleanValue(recordValue(usage.spend_control)?.reached) === true) {
    messages.push("Spend limit reached");
  }

  const snapshot = blankSnapshot(id, name, "percent");
  snapshot.email = nonEmpty(stringValue(usage.email));
  snapshot.membershipType = nonEmpty(stringValue(usage.plan_type));
  snapshot.displayMessage = messages.length === 0 ? null : messages.join(" · ");
  snapshot.used = used;
  snapshot.limit = used === null ? null : 100;
  snapshot.remaining = remaining;
  snapshot.totalPercentUsed = used;
  snapshot.billingCycleEnd = resetsAt;
  snapshot.daysUntilReset =
    resetsAt === null ? null : Math.max(0, Math.trunc((Date.parse(resetsAt) - now.getTime()) / 86_400_000));
  snapshot.windows = windows;
  snapshot.extraWindows = extraWindows;
  snapshot.credits = visibleCredits;
  snapshot.earnedResets = earnedResets;
  snapshot.fetchedAt = now.toISOString();
  snapshot.trayLabel = formatTrayLabel(name, snapshot.remaining, snapshot.unit);
  return snapshot;
}

function pushWindow(
  out: UsageWindow[],
  body: WindowBody | null,
  fallbackLabel: string,
  fallbackShort: string,
): void {
  if (!body) {
    return;
  }
  const labels = windowLabels(body.limitWindowSeconds, fallbackLabel, fallbackShort);
  out.push({
    label: labels.label,
    shortLabel: labels.shortLabel,
    usedPercent: Math.min(100, Math.max(0, body.usedPercent)),
    resetsAt: unixSeconds(body.resetAt),
  });
}

function windowLabels(
  seconds: number | null,
  fallbackLabel: string,
  fallbackShort: string,
): { label: string; shortLabel: string } {
  if (seconds === 18_000) {
    return { label: "5-hour", shortLabel: "5h" };
  }
  if (seconds !== null && seconds > 0 && seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    if (days === 7) {
      return { label: "Weekly", shortLabel: "7d" };
    }
    return { label: `${days}-day`, shortLabel: `${days}d` };
  }
  if (seconds !== null && seconds > 0 && seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return { label: `${hours}-hour`, shortLabel: `${hours}h` };
  }
  return { label: fallbackLabel, shortLabel: fallbackShort };
}

function shortExtraLabel(label: string): string {
  const compact = [...label].filter((char) => /[A-Za-z0-9]/.test(char)).join("");
  if (!compact) {
    return "other";
  }
  return [...compact].slice(0, 8).join("");
}

function creditsVisible(credits: CreditBalance): boolean {
  if (credits.unlimited || credits.hasCredits) {
    return true;
  }
  if (!credits.balance) {
    return false;
  }
  const amount = Number(credits.balance);
  return Number.isFinite(amount) && amount > 0;
}

function creditBalance(body: Record<string, unknown> | null): CreditBalance | null {
  if (!body) {
    return null;
  }
  return {
    hasCredits: booleanValue(body.has_credits) ?? false,
    unlimited: booleanValue(body.unlimited) ?? false,
    balance: balanceString(body.balance),
  };
}

function balanceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseRateLimit(
  value: unknown,
): { primary: WindowBody | null; secondary: WindowBody | null } | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }
  return {
    primary: parseWindow(record.primary_window),
    secondary: parseWindow(record.secondary_window),
  };
}

function parseWindow(value: unknown): WindowBody | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }
  const used = numberValue(record.used_percent);
  if (used === null) {
    return null;
  }
  return {
    usedPercent: used,
    limitWindowSeconds: integerValue(record.limit_window_seconds),
    resetAt: integerValue(record.reset_at),
  };
}

function unixSeconds(secs: number | null): string | null {
  if (secs === null || secs <= 0) {
    return null;
  }
  const date = new Date(secs * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
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

function integerValue(value: unknown): number | null {
  const number = numberValue(value);
  return number === null ? null : Math.trunc(number);
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmpty(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

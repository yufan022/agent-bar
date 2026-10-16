export type QuotaUnit = "cents" | "requests" | "percent";

export interface UsageWindow {
  label: string;
  shortLabel: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface CreditBalance {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export type AgentStatus = "ok" | "error" | "unsupported" | "comingSoon";

export interface OnDemandUsage {
  enabled: boolean;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: QuotaUnit;
}

export interface QuotaSnapshot {
  providerId: string;
  providerName: string;
  status: AgentStatus;
  email: string | null;
  membershipType: string | null;
  displayMessage: string | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: QuotaUnit;
  autoPercentUsed: number | null;
  apiPercentUsed: number | null;
  totalPercentUsed: number | null;
  billingCycleStart: string | null;
  billingCycleEnd: string | null;
  daysUntilReset: number | null;
  onDemand: OnDemandUsage | null;
  windows: UsageWindow[];
  extraWindows: UsageWindow[];
  credits: CreditBalance | null;
  earnedResets: number | null;
  trayLabel: string;
  error: string | null;
  fetchedAt: string;
}

export interface AgentsQuotaResponse {
  agents: QuotaSnapshot[];
  refreshedAt: string;
}

export function comingSoon(providerId: string, providerName: string): QuotaSnapshot {
  return {
    providerId,
    providerName,
    status: "comingSoon",
    email: null,
    membershipType: null,
    displayMessage: "Coming soon",
    used: null,
    limit: null,
    remaining: null,
    unit: "requests",
    autoPercentUsed: null,
    apiPercentUsed: null,
    totalPercentUsed: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    daysUntilReset: null,
    onDemand: null,
    windows: [],
    extraWindows: [],
    credits: null,
    earnedResets: null,
    trayLabel: providerName,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}

export function errorSnapshot(providerId: string, providerName: string, message: string): QuotaSnapshot {
  return {
    providerId,
    providerName,
    status: "error",
    email: null,
    membershipType: null,
    displayMessage: null,
    used: null,
    limit: null,
    remaining: null,
    unit: "requests",
    autoPercentUsed: null,
    apiPercentUsed: null,
    totalPercentUsed: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    daysUntilReset: null,
    onDemand: null,
    windows: [],
    extraWindows: [],
    credits: null,
    earnedResets: null,
    trayLabel: `${providerName} ?`,
    error: message,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatTrayLabel(prefix: string, remaining: number | null, unit: QuotaUnit): string {
  if (remaining === null) {
    return `${prefix} ?`;
  }
  if (unit === "cents") {
    return `${prefix} $${(remaining / 100).toFixed(1)}`;
  }
  if (unit === "percent") {
    return `${prefix} ${Math.round(remaining)}%`;
  }
  return `${prefix} ${Math.round(remaining)}`;
}

export function tooltipDetail(snapshot: QuotaSnapshot): string {
  if (snapshot.windows.length > 0) {
    const parts = snapshot.windows.map((window) => {
      const left = Math.min(100, Math.max(0, 100 - window.usedPercent));
      return `${window.shortLabel} ${Math.round(left)}%`;
    });
    return `${parts.join(" · ")} left`;
  }
  if (snapshot.remaining === null) {
    return "unknown";
  }
  if (snapshot.unit === "cents") {
    return `$${(snapshot.remaining / 100).toFixed(2)} left`;
  }
  if (snapshot.unit === "percent") {
    return `${Math.round(snapshot.remaining)}% left`;
  }
  return `${Math.round(snapshot.remaining)} left`;
}

export function formatTooltip(response: AgentsQuotaResponse): string {
  return response.agents
    .map((agent) => {
      if (agent.status === "ok") {
        return `${agent.providerName} · ${tooltipDetail(agent)}`;
      }
      if (agent.status === "comingSoon") {
        return `${agent.providerName} · coming soon`;
      }
      return `${agent.providerName} · ${agent.error ?? "error"}`;
    })
    .join("\n");
}

export function sanitizeError(message: string): string {
  let out = message;
  const bearer = out.indexOf("Bearer ");
  if (bearer !== -1) {
    out = `${out.slice(0, bearer)}Bearer [redacted]`;
  }
  if (out.length > 280) {
    out = `${out.slice(0, 277)}...`;
  }
  return out;
}

export function blankSnapshot(id: string, name: string, unit: QuotaUnit): QuotaSnapshot {
  return {
    providerId: id,
    providerName: name,
    status: "ok",
    email: null,
    membershipType: null,
    displayMessage: null,
    used: null,
    limit: null,
    remaining: null,
    unit,
    autoPercentUsed: null,
    apiPercentUsed: null,
    totalPercentUsed: null,
    billingCycleStart: null,
    billingCycleEnd: null,
    daysUntilReset: null,
    onDemand: null,
    windows: [],
    extraWindows: [],
    credits: null,
    earnedResets: null,
    trayLabel: `${name} ?`,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}

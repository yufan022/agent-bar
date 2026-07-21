export type QuotaUnit = "cents" | "requests";

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
  trayLabel: string;
  error: string | null;
  fetchedAt: string;
}

export interface AgentsQuotaResponse {
  agents: QuotaSnapshot[];
  refreshedAt: string;
}

export function formatAmount(value: number | null, unit: QuotaUnit): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  if (unit === "cents") {
    return `$${(value / 100).toFixed(2)}`;
  }
  return Math.round(value).toLocaleString();
}

export function formatRemaining(value: number | null, unit: QuotaUnit): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  if (unit === "cents") {
    return `$${(value / 100).toFixed(2)} left`;
  }
  return `${Math.round(value).toLocaleString()} left`;
}

export function percentUsed(snapshot: QuotaSnapshot): number | null {
  if (snapshot.totalPercentUsed !== null) {
    return snapshot.totalPercentUsed;
  }
  if (snapshot.used !== null && snapshot.limit !== null && snapshot.limit > 0) {
    return (snapshot.used / snapshot.limit) * 100;
  }
  return null;
}

export function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}


export type BridgeToolId = "claude" | "codex" | "opencode" | "cursor";

export const BRIDGE_TOOLS: { id: BridgeToolId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "cursor", label: "Cursor" },
];

export const BRIDGE_KINDS: { id: string; label: string }[] = [
  { id: "instructions", label: "Instructions" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
];

export interface BridgeSyncRequest {
  from: string;
  to: string[];
  only: string[];
  dryRun: boolean;
  prune: boolean;
  force: boolean;
}

export interface BridgeSyncResponse {
  ok: boolean;
  report: string;
}

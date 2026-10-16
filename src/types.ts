export type {
  AgentStatus,
  AgentsQuotaResponse,
  CreditBalance,
  OnDemandUsage,
  QuotaSnapshot,
  QuotaUnit,
  UsageWindow,
} from "../lib/quota/model.ts";
export type {
  DetailsInstructions,
  DetailsReport,
  DiffChange,
  DiffReport,
  InstructionsDiff,
  InstructionsStatus,
  NamedDiff,
  PathPresence,
  SkillInfo,
  StatusReport,
  SyncCategory,
  SyncLine,
  SyncLineStatus,
  SyncReport,
  SyncTargetReport,
  ToolStatus,
} from "../lib/bridge/report.ts";
export type { BridgeSyncRequest, BridgeSyncResponse } from "../lib/ipc-types.ts";

import type { QuotaSnapshot, QuotaUnit } from "../lib/quota/model.ts";

export function formatAmount(value: number | null, unit: QuotaUnit): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  if (unit === "cents") {
    return `$${(value / 100).toFixed(2)}`;
  }
  if (unit === "percent") {
    return `${Math.round(value)}%`;
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
  if (unit === "percent") {
    return `${Math.round(value)}% left`;
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

export type BridgeToolId = "claude" | "codex" | "opencode" | "cursor" | "pi" | "omp";

export const BRIDGE_TOOLS: { id: BridgeToolId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "cursor", label: "Cursor" },
  { id: "pi", label: "Pi" },
  { id: "omp", label: "OMP" },
];

export const BRIDGE_KINDS: { id: string; label: string }[] = [
  { id: "instructions", label: "Instructions" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
];

export function bridgeToolLabel(id: string): string {
  return BRIDGE_TOOLS.find((tool) => tool.id === id)?.label ?? id;
}

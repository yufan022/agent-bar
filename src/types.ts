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
  return BRIDGE_TOOLS.find((t) => t.id === id)?.label ?? id;
}

export interface BridgeSyncRequest {
  from: string;
  to: string[];
  only: string[];
  dryRun: boolean;
  prune: boolean;
  force: boolean;
}

export interface PathPresence {
  path: string;
  exists: boolean;
}

export type InstructionsStatus =
  | { state: "unsupported" }
  | { state: "missing"; path: string }
  | { state: "present"; path: string; realPath?: string; chars: number };

export interface ToolStatus {
  tool: string;
  instructions: InstructionsStatus;
  skillsDir: PathPresence;
  mcpConfig: PathPresence;
  skillCount: number;
  mcpServerCount: number;
}

export interface StatusReport {
  tools: ToolStatus[];
}

export interface SkillInfo {
  name: string;
  path: string;
}

export type DetailsInstructions =
  | { state: "unsupported"; path: string }
  | { state: "missing"; path: string }
  | { state: "present"; path: string; chars: number };

export interface DetailsReport {
  tool: string;
  skills: SkillInfo[];
  mcpServers: string[];
  instructions: DetailsInstructions;
}

export type DiffChange = "added" | "removed" | "same" | "changed";

export interface NamedDiff {
  name: string;
  change: DiffChange;
}

export type InstructionsDiff =
  | { state: "skipped"; reason: string }
  | {
      state: "compared";
      identical: boolean;
      fromPath?: string;
      toPath?: string;
      fromReal?: string;
      toReal?: string;
      summary: string;
    };

export interface DiffReport {
  from: string;
  to: string;
  instructions: InstructionsDiff;
  skills: NamedDiff[];
  mcp: NamedDiff[];
}

export type SyncLineStatus = "info" | "ok" | "skip" | "plan" | "done" | "error";
export type SyncCategory = "meta" | "instructions" | "skills" | "mcp";

export interface SyncLine {
  category: SyncCategory;
  status: SyncLineStatus;
  message: string;
  name?: string;
  path?: string;
  linkTo?: string;
  detail?: string[];
}

export interface SyncTargetReport {
  tool: string;
  items: SyncLine[];
}

export interface SyncReport {
  sourceTool: string;
  sourceHome: string;
  dryRun: boolean;
  notes: SyncLine[];
  targets: SyncTargetReport[];
  errors: string[];
}

export interface BridgeSyncResponse {
  ok: boolean;
  report: SyncReport;
}

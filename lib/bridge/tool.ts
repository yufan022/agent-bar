import { BridgeError } from "./error.ts";

export const TOOL_IDS = ["claude", "codex", "opencode", "cursor", "pi", "omp"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export interface SyncKinds {
  instructions: boolean;
  skills: boolean;
  mcp: boolean;
}

export type WriteMode = "safe" | "prune";

export function writeModeLabel(mode: WriteMode): "Safe" | "Prune" {
  return mode === "prune" ? "Prune" : "Safe";
}

export function allSyncKinds(): SyncKinds {
  return { instructions: true, skills: true, mcp: true };
}

export function parseToolId(value: string): ToolId {
  switch (value.trim().toLowerCase()) {
    case "claude":
    case "claude-code":
    case "claudecode":
      return "claude";
    case "codex":
      return "codex";
    case "opencode":
    case "open-code":
      return "opencode";
    case "cursor":
      return "cursor";
    case "pi":
    case "pi-coding-agent":
    case "pi-agent":
      return "pi";
    case "omp":
    case "oh-my-pi":
    case "oh-omp":
      return "omp";
    default:
      throw new BridgeError(`unsupported tool id: ${value.trim().toLowerCase()}`);
  }
}

export function parseSyncKinds(items: readonly string[]): SyncKinds {
  if (items.length === 0) {
    return allSyncKinds();
  }
  const kinds: SyncKinds = { instructions: false, skills: false, mcp: false };
  for (const item of items) {
    switch (item.trim().toLowerCase()) {
      case "instructions":
      case "instruction":
      case "instr":
        kinds.instructions = true;
        break;
      case "skills":
      case "skill":
        kinds.skills = true;
        break;
      case "mcp":
        kinds.mcp = true;
        break;
      default:
        throw new BridgeError(
          `unknown sync kind '${item.trim().toLowerCase()}' (expected instructions, skills, mcp)`,
        );
    }
  }
  return kinds;
}

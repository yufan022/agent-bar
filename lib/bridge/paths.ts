import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeError, ioError } from "./error.ts";
import type { ToolId } from "./tool.ts";

export interface ToolPaths {
  tool: ToolId;
  home: string;
  instructions: string | null;
  skillsDir: string;
  mcpConfig: string;
}

export function homeDirectory(): string {
  const home = os.homedir();
  if (!home) {
    throw new BridgeError("home directory could not be resolved");
  }
  return home;
}

export function pathsForTool(tool: ToolId, home: string = homeDirectory()): ToolPaths {
  switch (tool) {
    case "claude":
      return {
        tool,
        home,
        instructions: path.join(home, ".claude/CLAUDE.md"),
        skillsDir: path.join(home, ".claude/skills"),
        mcpConfig: path.join(home, ".claude.json"),
      };
    case "codex":
      return {
        tool,
        home,
        instructions: path.join(home, ".codex/AGENTS.md"),
        skillsDir: path.join(home, ".codex/skills"),
        mcpConfig: path.join(home, ".codex/config.toml"),
      };
    case "opencode":
      return {
        tool,
        home,
        instructions: path.join(home, ".config/opencode/AGENTS.md"),
        skillsDir: path.join(home, ".config/opencode/skills"),
        mcpConfig: path.join(home, ".config/opencode/opencode.json"),
      };
    case "cursor":
      return {
        tool,
        home,
        instructions: null,
        skillsDir: path.join(home, ".cursor/skills"),
        mcpConfig: path.join(home, ".cursor/mcp.json"),
      };
    case "pi":
      return {
        tool,
        home,
        instructions: path.join(home, ".pi/agent/AGENTS.md"),
        skillsDir: path.join(home, ".pi/agent/skills"),
        mcpConfig: path.join(home, ".pi/agent/mcp.json"),
      };
    case "omp":
      return {
        tool,
        home,
        instructions: path.join(home, ".omp/agent/AGENTS.md"),
        skillsDir: path.join(home, ".omp/agent/skills"),
        mcpConfig: path.join(home, ".omp/agent/mcp.json"),
      };
    default: {
      const unreachable: never = tool;
      throw new BridgeError(`unsupported tool id: ${String(unreachable)}`);
    }
  }
}

export function supportsInstructions(paths: ToolPaths): boolean {
  return paths.instructions !== null;
}

export function skillDir(paths: ToolPaths, name: string): string {
  return path.join(paths.skillsDir, name);
}

export function skillFile(paths: ToolPaths, name: string): string {
  return path.join(skillDir(paths, name), "SKILL.md");
}

export function ensureParent(filePath: string): void {
  const parent = path.dirname(filePath);
  if (!parent || parent === filePath) {
    return;
  }
  try {
    fs.mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw ioError(parent, error);
  }
}

import fs from "node:fs";
import { BridgeError } from "./error.ts";
import {
  instructionsRealPath,
  linkInstructions,
  readInstructions,
  writeInstructions,
} from "./instructions.ts";
import { readMcp, writeMcp } from "./mcp/mcp.ts";
import type { McpDocument } from "./mcp/types.ts";
import {
  pathsForTool,
  skillDir,
  supportsInstructions,
  type ToolPaths,
} from "./paths.ts";
import type { InstructionsStatus, ToolStatus } from "./report.ts";
import { linkSkill, listSkills, type SkillEntry } from "./skills.ts";
import type { LinkAction } from "./symlink.ts";
import type { ToolId, WriteMode } from "./tool.ts";

export class ToolAdapter {
  readonly paths: ToolPaths;

  constructor(paths: ToolPaths) {
    this.paths = paths;
  }

  static forTool(tool: ToolId, home?: string): ToolAdapter {
    return new ToolAdapter(home === undefined ? pathsForTool(tool) : pathsForTool(tool, home));
  }

  id(): ToolId {
    return this.paths.tool;
  }

  supportsInstructions(): boolean {
    return supportsInstructions(this.paths);
  }

  supportsSkillsSync(): boolean {
    return true;
  }

  instructionsPath(): string | null {
    return this.paths.instructions;
  }

  readInstructions(): string | null {
    if (!this.paths.instructions) {
      return null;
    }
    return readInstructions(this.paths.instructions);
  }

  instructionsRealPath(): string | null {
    if (!this.paths.instructions) {
      return null;
    }
    return instructionsRealPath(this.paths.instructions);
  }

  writeInstructions(body: string): void {
    if (!this.paths.instructions) {
      throw new BridgeError(
        `${this.id()} does not support file-based instruction sync (Cursor User Rules have no stable file API)`,
      );
    }
    writeInstructions(this.paths.instructions, body);
  }

  linkInstructions(sourcePath: string, force: boolean): LinkAction {
    if (!this.paths.instructions) {
      throw new BridgeError(
        `${this.id()} does not support file-based instruction sync (Cursor User Rules have no stable file API)`,
      );
    }
    return linkInstructions(this.paths.instructions, sourcePath, force);
  }

  listSkills(): SkillEntry[] {
    return listSkills(this.paths.skillsDir);
  }

  linkSkill(name: string, sourceRealPath: string, force: boolean): LinkAction {
    return linkSkill(skillDir(this.paths, name), sourceRealPath, force);
  }

  readMcp(): McpDocument {
    return readMcp(this.paths.tool, this.paths.mcpConfig);
  }

  writeMcp(doc: McpDocument, mode: WriteMode): void {
    writeMcp(this.paths.tool, this.paths.mcpConfig, doc, mode);
  }

  instructionsPathDisplay(): string {
    return this.paths.instructions ?? "(unsupported)";
  }

  toolStatus(): ToolStatus {
    let instructions: InstructionsStatus;
    if (!this.supportsInstructions()) {
      instructions = { state: "unsupported" };
    } else {
      const filePath = this.instructionsPathDisplay();
      const body = this.readInstructions();
      if (body === null) {
        instructions = { state: "missing", path: filePath };
      } else {
        const realPath = this.instructionsRealPath();
        instructions = {
          state: "present",
          path: filePath,
          ...(realPath ? { realPath } : {}),
          chars: [...body].length,
        };
      }
    }
    const skills = this.listSkills();
    const mcpCount = Object.keys(this.readMcp().servers).length;
    return {
      tool: this.id(),
      instructions,
      skillsDir: {
        path: this.paths.skillsDir,
        exists: fs.existsSync(this.paths.skillsDir),
      },
      mcpConfig: {
        path: this.paths.mcpConfig,
        exists: fs.existsSync(this.paths.mcpConfig),
      },
      skillCount: skills.length,
      mcpServerCount: mcpCount,
    };
  }
}

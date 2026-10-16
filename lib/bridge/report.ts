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

export function syncLine(
  category: SyncCategory,
  status: SyncLineStatus,
  message: string,
): SyncLine {
  return { category, status, message };
}

export function withName(line: SyncLine, name: string): SyncLine {
  return { ...line, name };
}

export function withPath(line: SyncLine, path: string): SyncLine {
  return { ...line, path };
}

export function withLinkTo(line: SyncLine, linkTo: string): SyncLine {
  return { ...line, linkTo };
}

export function withDetail(line: SyncLine, detail: string[]): SyncLine {
  return detail.length > 0 ? { ...line, detail } : line;
}

export function diffMark(change: DiffChange): string {
  switch (change) {
    case "added":
      return "+";
    case "removed":
      return "-";
    case "same":
      return "=";
    case "changed":
      return "~";
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

export function renderStatus(report: StatusReport): string {
  let out = "";
  for (const tool of report.tools) {
    out += `${renderToolStatus(tool)}\n`;
  }
  return out;
}

function renderToolStatus(tool: ToolStatus): string {
  const instrMark =
    tool.instructions.state === "unsupported"
      ? "n/a"
      : tool.instructions.state === "missing"
        ? "no"
        : "yes";
  let out = `${tool.tool}: instructions=${instrMark} skills_dir=${boolMark(tool.skillsDir.exists)} mcp=${boolMark(tool.mcpConfig.exists)}\n`;
  if (tool.instructions.state === "unsupported") {
    out += "  instructions: (unsupported)\n";
  } else if (tool.instructions.state === "missing") {
    out += `  instructions: ${tool.instructions.path}\n`;
  } else {
    out += `  instructions: ${tool.instructions.path}\n`;
    if (tool.instructions.realPath) {
      out += `  instructions_real: ${tool.instructions.realPath}\n`;
    }
    out += `  instructions_chars: ${tool.instructions.chars}\n`;
  }
  out += `  skills:       ${tool.skillsDir.path}\n`;
  out += `  mcp:          ${tool.mcpConfig.path}\n`;
  out += `  skill_count: ${tool.skillCount}\n`;
  out += `  mcp_server_count: ${tool.mcpServerCount}\n`;
  return out;
}

function boolMark(value: boolean): string {
  return value ? "yes" : "no";
}

export function renderDetails(report: DetailsReport): string {
  let out = `Tool: ${report.tool}\n\nSkills:\n`;
  if (report.skills.length === 0) {
    out += "  (none)\n";
  } else {
    for (const skill of report.skills) {
      out += `  - ${skill.name} (${skill.path})\n`;
    }
  }
  out += "\nMCP servers:\n";
  if (report.mcpServers.length === 0) {
    out += "  (none)\n";
  } else {
    for (const name of report.mcpServers) {
      out += `  - ${name}\n`;
    }
  }
  if (report.instructions.state === "unsupported") {
    out += `\nInstructions: ${report.instructions.path}\n`;
    out += "  unsupported (no stable file API)\n";
  } else if (report.instructions.state === "missing") {
    out += `\nInstructions: ${report.instructions.path}\n`;
    out += "  missing\n";
  } else {
    out += `\nInstructions: ${report.instructions.path}\n`;
    out += `  present (${report.instructions.chars} chars)\n`;
  }
  return out;
}

export function renderDiff(report: DiffReport): string {
  let out = "## Instructions\n";
  if (report.instructions.state === "skipped") {
    out += `(${report.instructions.reason})\n`;
  } else {
    out += report.instructions.summary;
    if (!report.instructions.summary.endsWith("\n")) {
      out += "\n";
    }
  }
  out += "\n## Skills\n";
  if (report.skills.length === 0) {
    out += "(none)\n";
  } else {
    for (const entry of report.skills) {
      out += `${diffMark(entry.change)} ${entry.name}\n`;
    }
  }
  out += "\n## MCP\n";
  if (report.mcp.length === 0) {
    out += "(none)\n";
  } else {
    for (const entry of report.mcp) {
      out += `${diffMark(entry.change)} ${entry.name}\n`;
    }
  }
  return out;
}

export function renderSync(report: SyncReport): string {
  let out = `Source: ${report.sourceTool} (${report.sourceHome})\n`;
  for (const note of report.notes) {
    out += renderSyncLine(note, 2);
  }
  for (const target of report.targets) {
    out += `\nTarget: ${target.tool}\n`;
    for (const item of target.items) {
      out += renderSyncLine(item, 2);
    }
  }
  if (report.errors.length > 0) {
    out += "\nErrors:\n";
    for (const error of report.errors) {
      out += `  - ${error}\n`;
    }
  }
  return out;
}

function renderSyncLine(line: SyncLine, indent: number): string {
  const pad = " ".repeat(indent);
  let out = `${pad}${line.message}\n`;
  for (const detail of line.detail ?? []) {
    out += `${pad}  ${detail}\n`;
  }
  return out;
}

export function textLines(value: string): string[] {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (body === "") {
    return [];
  }
  return body.split("\n");
}

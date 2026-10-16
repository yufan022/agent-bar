import path from "node:path";
import { ToolAdapter } from "./adapters.ts";
import { BridgeError } from "./error.ts";
import { formatInstructionsComparison } from "./instructions.ts";
import { mcpDocumentsEqual, normalizeMcpForTool, sseConversionsForCodex } from "./mcp/mcp.ts";
import type { McpDocument } from "./mcp/types.ts";
import {
  syncLine,
  textLines,
  withDetail,
  withLinkTo,
  withName,
  withPath,
  type DetailsInstructions,
  type DetailsReport,
  type DiffChange,
  type DiffReport,
  type InstructionsDiff,
  type NamedDiff,
  type SkillInfo,
  type StatusReport,
  type SyncLine,
  type SyncReport,
  type SyncTargetReport,
} from "./report.ts";
import { listOrphanSkillLinks, pruneSkillLinks, type SkillEntry } from "./skills.ts";
import { TOOL_IDS, writeModeLabel, type SyncKinds, type ToolId, type WriteMode } from "./tool.ts";

export interface SyncOptions {
  from: ToolId;
  to: ToolId[];
  kinds: SyncKinds;
  dryRun: boolean;
  prune: boolean;
  force: boolean;
  home?: string;
}

export function sync(options: SyncOptions): SyncReport {
  if (options.to.length === 0) {
    throw new BridgeError("at least one --to target is required");
  }
  for (const target of options.to) {
    if (target === options.from) {
      throw new BridgeError(`source and target tools must differ (got ${options.from})`);
    }
  }

  const source = adapter(options.from, options.home);
  const report: SyncReport = {
    sourceTool: source.id(),
    sourceHome: source.paths.home,
    dryRun: options.dryRun,
    notes: [],
    targets: [],
    errors: [],
  };

  const sourceSupportsInstructions = source.supportsInstructions();
  const sourceInstructionsPath =
    options.kinds.instructions && sourceSupportsInstructions ? source.instructionsRealPath() : null;
  const skills = options.kinds.skills ? source.listSkills() : [];
  const mcp = options.kinds.mcp ? source.readMcp() : { servers: {} };

  if (options.kinds.instructions) {
    if (!sourceSupportsInstructions) {
      report.notes.push(
        syncLine(
          "instructions",
          "skip",
          `instructions: skipped (${source.id()} has no file-based instructions)`,
        ),
      );
    } else if (sourceInstructionsPath) {
      report.notes.push(
        withPath(
          syncLine("instructions", "info", `instructions source: ${sourceInstructionsPath}`),
          sourceInstructionsPath,
        ),
      );
    } else {
      report.notes.push(
        syncLine("instructions", "skip", "instructions: source file missing (skip links)"),
      );
    }
  }
  if (options.kinds.skills) {
    report.notes.push(syncLine("skills", "info", `read ${skills.length} skill(s)`));
  }
  if (options.kinds.mcp) {
    report.notes.push(syncLine("mcp", "info", `read ${Object.keys(mcp.servers).length} MCP server(s)`));
  }

  const writeMode: WriteMode = options.prune ? "prune" : "safe";

  for (const targetId of options.to) {
    const target = adapter(targetId, options.home);
    const items: SyncLine[] = [];
    if (options.kinds.instructions) {
      items.push(
        ...syncInstructions(source, target, sourceInstructionsPath, options.dryRun, options.force, report),
      );
    }
    if (options.kinds.skills) {
      items.push(...syncSkills(source, target, skills, options, report));
    }
    if (options.kinds.mcp) {
      items.push(...syncMcp(target, targetId, mcp, writeMode, options.dryRun));
    }
    report.targets.push({ tool: target.id(), items });
  }
  return report;
}

function syncInstructions(
  source: ToolAdapter,
  target: ToolAdapter,
  sourceInstructionsPath: string | null,
  dryRun: boolean,
  force: boolean,
  report: SyncReport,
): SyncLine[] {
  if (!target.supportsInstructions()) {
    return [
      syncLine(
        "instructions",
        "skip",
        `instructions: skipped (${target.id()} has no file-based instructions)`,
      ),
    ];
  }
  if (!sourceInstructionsPath) {
    return [syncLine("instructions", "skip", "instructions: skipped (source missing or unsupported)")];
  }
  const linkPath = target.instructionsPath();
  if (!linkPath) {
    return [];
  }
  const targetReal = target.instructionsRealPath();
  if (targetReal === sourceInstructionsPath) {
    return [syncLine("instructions", "ok", "instructions: unchanged")];
  }
  if (dryRun) {
    const srcBody = source.readInstructions() ?? "";
    const dstBody = target.readInstructions() ?? "";
    const comparison = formatInstructionsComparison(
      `${source.id()} (source)`,
      `${target.id()} (target)`,
      source.instructionsPath(),
      target.instructionsPath(),
      sourceInstructionsPath,
      targetReal,
      srcBody,
      dstBody,
    );
    return [
      withDetail(
        withLinkTo(
          withPath(
            syncLine(
              "instructions",
              "plan",
              `instructions: would symlink ${linkPath} -> ${sourceInstructionsPath}`,
            ),
            linkPath,
          ),
          sourceInstructionsPath,
        ),
        textLines(comparison),
      ),
    ];
  }
  try {
    const action = target.linkInstructions(sourceInstructionsPath, force);
    return [
      withLinkTo(
        withPath(
          syncLine(
            "instructions",
            "done",
            `instructions: ${action} ${linkPath} -> ${sourceInstructionsPath}`,
          ),
          linkPath,
        ),
        sourceInstructionsPath,
      ),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(`${target.id()} instructions: ${message}`);
    return [syncLine("instructions", "error", `instructions: ERROR ${message}`)];
  }
}

function syncSkills(
  source: ToolAdapter,
  target: ToolAdapter,
  skills: SkillEntry[],
  options: SyncOptions,
  report: SyncReport,
): SyncLine[] {
  if (!target.supportsSkillsSync()) {
    return [
      syncLine("skills", "skip", `skills: skipped (${target.id()} skill sync is disabled)`),
    ];
  }
  const items: SyncLine[] = [];
  const keep = new Set(skills.map((skill) => skill.name));
  for (const skill of skills) {
    if (options.dryRun) {
      const link = path.join(target.paths.skillsDir, skill.name);
      items.push(
        withLinkTo(
          withPath(
            withName(
              syncLine(
                "skills",
                "plan",
                `skill '${skill.name}': would symlink ${link} -> ${skill.realPath}`,
              ),
              skill.name,
            ),
            link,
          ),
          skill.realPath,
        ),
      );
      continue;
    }
    try {
      const action = target.linkSkill(skill.name, skill.realPath, options.force);
      items.push(
        withName(syncLine("skills", "done", `skill '${skill.name}': ${action}`), skill.name),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push(`${target.id()} skill '${skill.name}': ${message}`);
      items.push(
        withName(
          syncLine("skills", "error", `skill '${skill.name}': ERROR ${message}`),
          skill.name,
        ),
      );
    }
  }
  if (options.prune) {
    const sourceSkills = source.paths.skillsDir;
    if (options.dryRun) {
      const orphans = listOrphanSkillLinks(target.paths.skillsDir, keep, sourceSkills);
      if (orphans.length === 0) {
        items.push(syncLine("skills", "ok", "skills prune: no orphan symlinks"));
      } else {
        for (const name of orphans) {
          items.push(
            withName(syncLine("skills", "plan", `skill '${name}': would prune symlink`), name),
          );
        }
      }
    } else {
      const removed = pruneSkillLinks(target.paths.skillsDir, keep, sourceSkills);
      for (const name of removed) {
        items.push(withName(syncLine("skills", "done", `skill '${name}': pruned symlink`), name));
      }
    }
  }
  return items;
}

function syncMcp(
  target: ToolAdapter,
  targetId: ToolId,
  mcp: McpDocument,
  writeMode: WriteMode,
  dryRun: boolean,
): SyncLine[] {
  const items: SyncLine[] = [];
  const existing = target.readMcp();
  const toWrite = normalizeMcpForTool(targetId, mcp);
  if (targetId === "codex") {
    for (const name of sseConversionsForCodex(mcp)) {
      items.push(
        withName(
          syncLine("mcp", "info", `mcp '${name}': converting SSE → streamable HTTP for Codex`),
          name,
        ),
      );
    }
  }
  if (mcpDocumentsEqual(existing, toWrite) && writeMode === "safe") {
    items.push(syncLine("mcp", "ok", "mcp: unchanged"));
    return items;
  }
  if (dryRun) {
    const detail = mcpPlanDetail(existing, toWrite, writeMode);
    items.push(
      withDetail(
        syncLine(
          "mcp",
          "plan",
          `mcp: would write ${Object.keys(toWrite.servers).length} server(s) (${writeModeLabel(writeMode)})`,
        ),
        detail,
      ),
    );
    return items;
  }
  target.writeMcp(mcp, writeMode);
  items.push(
    withPath(
      syncLine(
        "mcp",
        "done",
        `mcp: wrote ${target.paths.mcpConfig} (${writeModeLabel(writeMode)})`,
      ),
      target.paths.mcpConfig,
    ),
  );
  return items;
}

function mcpPlanDetail(existing: McpDocument, toWrite: McpDocument, writeMode: WriteMode): string[] {
  const srcNames = new Set(Object.keys(toWrite.servers));
  const dstNames = new Set(Object.keys(existing.servers));
  const detail: string[] = [];
  for (const name of sortedDifference(srcNames, dstNames)) {
    detail.push(`+ ${name}`);
  }
  if (writeMode === "prune") {
    for (const name of sortedDifference(dstNames, srcNames)) {
      detail.push(`- ${name}`);
    }
  }
  for (const name of sortedIntersection(srcNames, dstNames)) {
    const left = existing.servers[name];
    const right = toWrite.servers[name];
    if (left && right && !mcpDocumentsEqual({ servers: { [name]: left } }, { servers: { [name]: right } })) {
      detail.push(`~ ${name}`);
    }
  }
  return detail;
}

export function diff(from: ToolId, to: ToolId, home?: string): DiffReport {
  if (from === to) {
    throw new BridgeError(`source and target tools must differ (got ${from})`);
  }
  const source = adapter(from, home);
  const target = adapter(to, home);
  const instructions = diffInstructions(source, target, from, to);
  const srcSkills = new Set(source.listSkills().map((skill) => skill.name));
  const dstSkills = new Set(target.listSkills().map((skill) => skill.name));
  const skills = namedDiff(srcSkills, dstSkills, () => "same");
  const srcMcp = source.readMcp();
  const dstMcp = target.readMcp();
  const srcForTarget = normalizeMcpForTool(to, srcMcp);
  const srcNames = new Set(Object.keys(srcForTarget.servers));
  const dstNames = new Set(Object.keys(dstMcp.servers));
  const mcp = namedDiff(srcNames, dstNames, (name) => {
    const left = srcForTarget.servers[name];
    const right = dstMcp.servers[name];
    if (left && right && mcpDocumentsEqual({ servers: { [name]: left } }, { servers: { [name]: right } })) {
      return "same";
    }
    return "changed";
  });
  return { from, to, instructions, skills, mcp };
}

function diffInstructions(
  source: ToolAdapter,
  target: ToolAdapter,
  from: ToolId,
  to: ToolId,
): InstructionsDiff {
  if (!source.supportsInstructions() && !target.supportsInstructions()) {
    return {
      state: "skipped",
      reason: `skipped: neither ${from} nor ${to} supports file-based instructions`,
    };
  }
  if (!source.supportsInstructions()) {
    return {
      state: "skipped",
      reason: `skipped: ${from} does not support file-based instructions`,
    };
  }
  if (!target.supportsInstructions()) {
    return {
      state: "skipped",
      reason: `skipped: ${to} does not support file-based instructions`,
    };
  }
  const srcReal = source.instructionsRealPath();
  const dstReal = target.instructionsRealPath();
  const srcBody = source.readInstructions() ?? "";
  const dstBody = target.readInstructions() ?? "";
  const summary = formatInstructionsComparison(
    from,
    to,
    source.instructionsPath(),
    target.instructionsPath(),
    srcReal,
    dstReal,
    srcBody,
    dstBody,
  );
  return {
    state: "compared",
    identical: srcReal === dstReal,
    ...(source.instructionsPath() ? { fromPath: source.instructionsPath() ?? undefined } : {}),
    ...(target.instructionsPath() ? { toPath: target.instructionsPath() ?? undefined } : {}),
    ...(srcReal ? { fromReal: srcReal } : {}),
    ...(dstReal ? { toReal: dstReal } : {}),
    summary,
  };
}

export function status(tool: ToolId | null, home?: string): StatusReport {
  const tools = tool ? [tool] : [...TOOL_IDS];
  return { tools: tools.map((id) => adapter(id, home).toolStatus()) };
}

export function details(tool: ToolId, home?: string): DetailsReport {
  const current = adapter(tool, home);
  const skills: SkillInfo[] = current.listSkills().map((skill) => ({
    name: skill.name,
    path: skill.realPath,
  }));
  const mcpServers = Object.keys(current.readMcp().servers).sort(compareText);
  let instructions: DetailsInstructions;
  if (!current.supportsInstructions()) {
    instructions = { state: "unsupported", path: current.instructionsPathDisplay() };
  } else {
    const body = current.readInstructions();
    if (body === null) {
      instructions = { state: "missing", path: current.instructionsPathDisplay() };
    } else {
      instructions = {
        state: "present",
        path: current.instructionsPathDisplay(),
        chars: [...body].length,
      };
    }
  }
  return { tool, skills, mcpServers, instructions };
}

function adapter(tool: ToolId, home: string | undefined): ToolAdapter {
  return ToolAdapter.forTool(tool, home);
}

function namedDiff(
  source: ReadonlySet<string>,
  target: ReadonlySet<string>,
  sameChange: (name: string) => DiffChange,
): NamedDiff[] {
  const entries: NamedDiff[] = [];
  for (const name of sortedDifference(source, target)) {
    entries.push({ name, change: "added" });
  }
  for (const name of sortedDifference(target, source)) {
    entries.push({ name, change: "removed" });
  }
  for (const name of sortedIntersection(source, target)) {
    entries.push({ name, change: sameChange(name) });
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  return entries;
}

function sortedDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((name) => !right.has(name)).sort(compareText);
}

function sortedIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((name) => right.has(name)).sort(compareText);
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export type { SyncTargetReport };

import { renderDetails, renderDiff, renderStatus, renderSync } from "../bridge/report.ts";
import { details, diff, status, sync } from "../bridge/sync.ts";
import { parseSyncKinds, parseToolId } from "../bridge/tool.ts";

const VERSION = "0.1.0";

export function runCli(program: "agent-bridge" | "agent-bar", argv: string[]): number {
  try {
    const parsed = extractHome(argv);
    if (parsed.version && parsed.rest.length === 0) {
      process.stdout.write(`${program} ${VERSION}\n`);
      return 0;
    }
    if (parsed.help && parsed.rest.length === 0) {
      process.stdout.write(topHelp(program));
      return 0;
    }
    return dispatch(program, parsed.rest, parsed.home, parsed.help, parsed.version);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}

function dispatch(
  program: "agent-bridge" | "agent-bar",
  argv: string[],
  home: string | undefined,
  help: boolean,
  version: boolean,
): number {
  let rest = argv;
  if (program === "agent-bar") {
    const command = rest[0];
    if (!command) {
      process.stdout.write(topHelp(program));
      return 1;
    }
    if (command === "--help" || command === "-h") {
      process.stdout.write(topHelp(program));
      return 0;
    }
    if (command === "--version" || command === "-V") {
      process.stdout.write(`${program} ${VERSION}\n`);
      return 0;
    }
    if (command !== "bridge") {
      throw new Error(`unknown command '${command}'`);
    }
    rest = rest.slice(1);
    if (rest.length === 0) {
      process.stdout.write(bridgeHelp(program));
      return help ? 0 : 1;
    }
  }
  const sub = rest[0];
  if (!sub) {
    process.stdout.write(program === "agent-bar" ? bridgeHelp(program) : topHelp(program));
    return 1;
  }
  if (sub === "--help" || sub === "-h" || (help && rest.length === 1)) {
    process.stdout.write(program === "agent-bar" ? bridgeHelp(program) : topHelp(program));
    return 0;
  }
  if (version && rest.length === 1 && (sub === "--version" || sub === "-V")) {
    process.stdout.write(`${program} ${VERSION}\n`);
    return 0;
  }
  const args = rest.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(commandHelp(program, sub));
    return 0;
  }
  switch (sub) {
    case "sync":
      return runSync(args, home);
    case "diff":
      return runDiff(args, home);
    case "status":
      return runStatus(args, home);
    case "details":
      return runDetails(args, home);
    default:
      throw new Error(`unknown command '${sub}'`);
  }
}

function runSync(argv: string[], home: string | undefined): number {
  const flags = parseFlags(argv, ["dry-run", "prune", "force"], ["from", "to", "only"]);
  const from = required(flags, "from");
  const to = splitList(flags.values.get("to") ?? []);
  if (to.length === 0) {
    throw new Error("--to is required");
  }
  const report = sync({
    from: parseToolId(from),
    to: to.map((item) => parseToolId(item)),
    kinds: parseSyncKinds(splitList(flags.values.get("only") ?? [])),
    dryRun: flags.bools.has("dry-run"),
    prune: flags.bools.has("prune"),
    force: flags.bools.has("force"),
    ...(home ? { home } : {}),
  });
  process.stdout.write(renderSync(report));
  if (report.errors.length > 0) {
    process.stderr.write("error: sync completed with errors\n");
    return 1;
  }
  return 0;
}

function runDiff(argv: string[], home: string | undefined): number {
  const flags = parseFlags(argv, [], ["from", "to"]);
  const report = diff(parseToolId(required(flags, "from")), parseToolId(required(flags, "to")), home);
  process.stdout.write(renderDiff(report));
  return 0;
}

function runStatus(argv: string[], home: string | undefined): number {
  const flags = parseFlags(argv, [], ["tool"]);
  const toolValue = flags.values.get("tool")?.[0];
  const tool = toolValue ? parseToolId(toolValue) : null;
  process.stdout.write(renderStatus(status(tool, home)));
  return 0;
}

function runDetails(argv: string[], home: string | undefined): number {
  const flags = parseFlags(argv, [], ["tool"]);
  process.stdout.write(renderDetails(details(parseToolId(required(flags, "tool")), home)));
  return 0;
}

interface ParsedFlags {
  bools: Set<string>;
  values: Map<string, string[]>;
}

function parseFlags(argv: string[], boolFlags: string[], valueFlags: string[]): ParsedFlags {
  const bools = new Set<string>();
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument '${arg}'`);
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg : arg.slice(0, eq)).slice(2);
    if (boolFlags.includes(name) && eq === -1) {
      bools.add(name);
      continue;
    }
    if (!valueFlags.includes(name)) {
      throw new Error(`unexpected argument '${arg}'`);
    }
    const value = eq === -1 ? argv[index + 1] : arg.slice(eq + 1);
    if (eq === -1) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} requires a value`);
    }
    const existing = values.get(name) ?? [];
    existing.push(value);
    values.set(name, existing);
  }
  return { bools, values };
}

function required(flags: ParsedFlags, name: string): string {
  const value = flags.values.get(name)?.[0];
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function splitList(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

function extractHome(argv: string[]): { rest: string[]; home?: string; help: boolean; version: boolean } {
  const rest: string[] = [];
  let home: string | undefined;
  let help = false;
  let version = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--home") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--home requires a directory");
      }
      home = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--home=")) {
      home = arg.slice("--home=".length);
      if (!home) {
        throw new Error("--home requires a directory");
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      rest.push(arg);
      continue;
    }
    if (arg === "--version" || arg === "-V") {
      version = true;
      rest.push(arg);
      continue;
    }
    rest.push(arg);
  }
  return { rest, ...(home ? { home } : {}), help, version };
}

function topHelp(program: "agent-bridge" | "agent-bar"): string {
  if (program === "agent-bar") {
    return `agent-bar ${VERSION}
agent-bar CLI — use bridge to sync AI coding agent global configs

Usage: agent-bar bridge <command>

Commands:
  bridge    Sync instructions, skills, and MCP across coding agents

Options:
  --home <dir>   Override the home directory
  -h, --help     Show help
  -V, --version  Show version
`;
  }
  return `agent-bridge ${VERSION}
Sync instructions, skills, and MCP configs across Claude Code, Codex, OpenCode, Cursor, Pi, and OMP

Usage: agent-bridge <command>

Commands:
  sync       Sync resources from one tool to one or more targets
  diff       Show a diff between two tools
  status     Probe global paths and counts
  details    Show skills, MCP servers, and instructions for a tool

Options:
  --home <dir>   Override the home directory
  -h, --help     Show help
  -V, --version  Show version
`;
}

function bridgeHelp(program: string): string {
  return `${program} bridge
Sync instructions, skills, and MCP across Claude / Codex / OpenCode / Cursor / Pi / OMP

Usage: ${program} bridge <command>

Commands:
  sync       Sync resources from one tool to one or more targets
  diff       Show a diff between two tools
  status     Probe global paths and counts
  details    Show skills, MCP servers, and instructions for a tool
`;
}

function commandHelp(program: string, command: string): string {
  const prefix = program === "agent-bar" ? "agent-bar bridge" : "agent-bridge";
  switch (command) {
    case "sync":
      return `${prefix} sync
Sync resources from one tool to one or more targets

Options:
  --from <tool>          Source tool: claude, codex, opencode, cursor, pi, omp
  --to <tools>           Target tools, comma-separated
  --only <kinds>         Limit to instructions, skills, mcp (default: all)
  --dry-run              Preview changes without writing
  --prune                Delete target MCP servers and skill symlinks absent from source
  --force                Replace conflicting paths with symlinks
`;
    case "diff":
      return `${prefix} diff
Show a diff between two tools

Options:
  --from <tool>
  --to <tool>
`;
    case "status":
      return `${prefix} status
Probe global paths and counts

Options:
  --tool <tool>          Optional single tool
`;
    case "details":
      return `${prefix} details
Show skills, MCP servers, and instructions for a tool

Options:
  --tool <tool>
`;
    default:
      return topHelp(program === "agent-bar" ? "agent-bar" : "agent-bridge");
  }
}

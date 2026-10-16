import { parse } from "smol-toml";
import { BridgeError, errorMessage } from "../error.ts";
import { atomicWrite, readOptional } from "../fsutil.ts";
import { asRecord } from "../jsonc.ts";
import type { McpDocument, McpServer } from "./types.ts";
import type { WriteMode } from "../tool.ts";

export function readCodexDocument(filePath: string): McpDocument {
  const raw = readOptional(filePath);
  if (raw === null) {
    return { servers: {} };
  }
  const value = parseTomlDocument(raw, filePath);
  const serversValue = value.mcp_servers;
  if (serversValue === undefined) {
    return { servers: {} };
  }
  const serversObj = asRecord(serversValue);
  if (!serversObj) {
    throw new BridgeError(`invalid MCP config at ${filePath}: mcp_servers must be a table`);
  }
  const servers: Record<string, McpServer> = {};
  for (const name of Object.keys(serversObj)) {
    const entry = asRecord(serversObj[name]);
    if (!entry) {
      throw new BridgeError(
        `invalid MCP config at ${filePath}: mcp_servers.${name} must be a table`,
      );
    }
    servers[name] = parseCodexServer(filePath, name, entry);
  }
  return { servers };
}

export function writeCodexDocument(filePath: string, doc: McpDocument, mode: WriteMode): void {
  const raw = readOptional(filePath) ?? "";
  const parsed = raw.trim() === "" ? {} : parseTomlDocument(raw, filePath);
  const existing = asRecord(parsed.mcp_servers) ?? {};
  const drop = new Set(Object.keys(doc.servers));
  if (mode === "prune") {
    for (const name of Object.keys(existing)) {
      if (!Object.prototype.hasOwnProperty.call(doc.servers, name)) {
        drop.add(name);
      }
    }
  }
  const stripped = stripCodexServers(raw, drop);
  const rendered = renderCodexServers(doc);
  let next: string;
  if (stripped.trim() === "") {
    next = rendered || "[mcp_servers]\n";
  } else if (rendered === "") {
    next = stripped.endsWith("\n") ? stripped : `${stripped}\n`;
  } else {
    next = `${stripped.replace(/\s*$/, "")}\n\n${rendered}`;
  }
  if (!next.endsWith("\n")) {
    next += "\n";
  }
  atomicWrite(filePath, next);
}

function parseCodexServer(
  filePath: string,
  name: string,
  table: Record<string, unknown>,
): McpServer {
  if (typeof table.url === "string") {
    const headers = stringMap(table.http_headers);
    const bearer = typeof table.bearer_token_env_var === "string" ? table.bearer_token_env_var : null;
    if (bearer && !Object.prototype.hasOwnProperty.call(headers, "Authorization")) {
      headers.Authorization = `Bearer \${${bearer}}`;
    }
    return {
      name,
      transport: {
        kind: "http",
        url: table.url,
        headers,
        protocol: "streamable-http",
      },
    };
  }
  if (typeof table.command !== "string") {
    throw new BridgeError(
      `invalid MCP config at ${filePath}: mcp_servers.${name} needs command or url`,
    );
  }
  return {
    name,
    transport: {
      kind: "stdio",
      command: table.command,
      args: stringList(table.args),
      env: stringMap(table.env),
    },
  };
}

function parseTomlDocument(raw: string, filePath: string): Record<string, unknown> {
  try {
    const value: unknown = parse(raw);
    const object = asRecord(value);
    if (!object) {
      throw new Error("root must be a table");
    }
    return object;
  } catch (error) {
    throw new BridgeError(`failed to parse TOML at ${filePath}: ${errorMessage(error)}`);
  }
}

function stringMap(value: unknown): Record<string, string> {
  const object = asRecord(value);
  if (!object) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const key of Object.keys(object)) {
    const item = object[key];
    if (typeof item === "string") {
      map[key] = item;
    }
  }
  return map;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

function renderCodexServers(doc: McpDocument): string {
  const names = Object.keys(doc.servers).sort(compareText);
  if (names.length === 0) {
    return "";
  }
  return `${names.map((name) => renderCodexServer(name, doc.servers[name]!)).join("\n")}\n`;
}

function renderCodexServer(name: string, server: McpServer): string {
  const lines = [`[mcp_servers.${formatTomlKey(name)}]`];
  if (server.transport.kind === "stdio") {
    lines.push(`command = ${tomlString(server.transport.command)}`);
    if (server.transport.args.length > 0) {
      lines.push(`args = [${server.transport.args.map(tomlString).join(", ")}]`);
    }
    const envKeys = Object.keys(server.transport.env).sort(compareText);
    if (envKeys.length > 0) {
      const pairs = envKeys.map(
        (key) => `${formatTomlKey(key)} = ${tomlString(server.transport.kind === "stdio" ? server.transport.env[key] ?? "" : "")}`,
      );
      lines.push(`env = { ${pairs.join(", ")} }`);
    }
    return lines.join("\n");
  }

  lines.push(`url = ${tomlString(server.transport.url)}`);
  let bearer: string | null = null;
  const other: Record<string, string> = {};
  for (const key of Object.keys(server.transport.headers).sort(compareText)) {
    const value = server.transport.headers[key] ?? "";
    if (key.toLowerCase() === "authorization" && value.startsWith("Bearer ")) {
      const variable = extractSimpleEnvVar(value.slice("Bearer ".length));
      if (variable) {
        bearer = variable;
        continue;
      }
    }
    other[key] = value;
  }
  if (bearer) {
    lines.push(`bearer_token_env_var = ${tomlString(bearer)}`);
  }
  const headerKeys = Object.keys(other).sort(compareText);
  if (headerKeys.length > 0) {
    const pairs = headerKeys.map((key) => `${formatTomlKey(key)} = ${tomlString(other[key] ?? "")}`);
    lines.push(`http_headers = { ${pairs.join(", ")} }`);
  }
  return lines.join("\n");
}

export function extractSimpleEnvVar(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(2, -1);
    const name = inner.startsWith("env:") ? inner.slice("env:".length) : inner;
    if (name.length > 0 && !name.includes(":") && !name.includes("-")) {
      return name;
    }
    const defaultSplit = name.split(":-");
    if (defaultSplit.length > 1 && defaultSplit[0]) {
      return defaultSplit[0];
    }
    return name;
  }
  if (trimmed.startsWith("{env:") && trimmed.endsWith("}")) {
    return trimmed.slice("{env:".length, -1);
  }
  return null;
}

function formatTomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) {
    return key;
  }
  return tomlString(key);
}

function tomlString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

function stripCodexServers(raw: string, drop: ReadonlySet<string>): string {
  if (raw === "" || drop.size === 0) {
    return raw;
  }
  const lines = splitTomlLines(raw);
  const out: string[] = [];
  let currentTable: string | null = null;
  let skippingServer: string | null = null;
  const scanner = new TomlValueScanner();
  let skippingValue = false;

  const consumeValue = (text: string): void => {
    scanner.push(text);
    scanner.push("\n");
    skippingValue = !scanner.done;
    if (scanner.done) {
      scanner.reset();
    }
  };

  for (const line of lines) {
    if (skippingValue) {
      consumeValue(line);
      continue;
    }
    const header = parseTomlHeader(line);
    if (header !== null) {
      const server = serverNameFromHeader(header);
      if (server && drop.has(server)) {
        skippingServer = server;
        currentTable = header;
        continue;
      }
      skippingServer = null;
      currentTable = header;
      out.push(line);
      continue;
    }
    if (skippingServer) {
      continue;
    }
    const assignment = parseAssignment(line);
    if (assignment) {
      if (currentTable === null) {
        const server = rootMcpServerName(assignment.key);
        if (server && drop.has(server)) {
          scanner.reset();
          consumeValue(line.slice(assignment.equals + 1));
          continue;
        }
      } else if (currentTable === "mcp_servers") {
        const server = topSegment(assignment.key);
        if (drop.has(server)) {
          scanner.reset();
          consumeValue(line.slice(assignment.equals + 1));
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function splitTomlLines(raw: string): string[] {
  const normalized = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const trailing = normalized.endsWith("\n");
  const body = trailing ? normalized.slice(0, -1) : normalized;
  if (body === "") {
    return [];
  }
  const lines = body.split("\n");
  if (trailing) {
    lines.push("");
  }
  return lines;
}

function parseTomlHeader(line: string): string | null {
  const trimmed = line.trim();
  const arrayTable = /^\[\[(.+)\]\]\s*(?:#.*)?$/.exec(trimmed);
  if (arrayTable?.[1]) {
    return arrayTable[1].trim();
  }
  const table = /^\[([^[]+)\]\s*(?:#.*)?$/.exec(trimmed);
  if (table?.[1]) {
    return table[1].trim();
  }
  return null;
}

function serverNameFromHeader(header: string): string | null {
  const parts = splitTomlDots(header).map(unquoteTomlKey);
  if (parts[0] !== "mcp_servers" || parts.length < 2) {
    return null;
  }
  return parts[1] ?? null;
}

function rootMcpServerName(key: string): string | null {
  const parts = splitTomlDots(key).map(unquoteTomlKey);
  if (parts[0] !== "mcp_servers") {
    return null;
  }
  return parts[1] ?? null;
}

function topSegment(key: string): string {
  const parts = splitTomlDots(key).map(unquoteTomlKey);
  return parts[0] ?? key;
}

function parseAssignment(line: string): { key: string; equals: number } | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("[")) {
    return null;
  }
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "=") {
      const key = line.slice(0, index).trim();
      if (!key) {
        return null;
      }
      return { key, equals: index };
    }
  }
  return null;
}

function splitTomlDots(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of key) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ".") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function unquoteTomlKey(key: string): string {
  const trimmed = key.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed
      .slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll("\\'", "'")
      .replaceAll("\\\\", "\\");
  }
  return trimmed;
}

class TomlValueScanner {
  private quote: '"' | "'" | null = null;
  private triple = false;
  private escaped = false;
  private braces = 0;
  private brackets = 0;
  private started = false;

  reset(): void {
    this.quote = null;
    this.triple = false;
    this.escaped = false;
    this.braces = 0;
    this.brackets = 0;
    this.started = false;
  }

  push(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] ?? "";
      if (this.quote) {
        if (this.triple) {
          if (char === this.quote && text.slice(index, index + 3) === this.quote.repeat(3)) {
            this.quote = null;
            this.triple = false;
            index += 2;
          }
          continue;
        }
        if (this.escaped) {
          this.escaped = false;
          continue;
        }
        if (char === "\\" && this.quote === '"') {
          this.escaped = true;
          continue;
        }
        if (char === this.quote) {
          this.quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        this.started = true;
        const isTriple = text.slice(index, index + 3) === char.repeat(3);
        this.quote = char;
        this.triple = isTriple;
        if (isTriple) {
          index += 2;
        }
        continue;
      }
      if (char === "#") {
        return;
      }
      if (char === "{") {
        this.braces += 1;
        this.started = true;
        continue;
      }
      if (char === "}") {
        this.braces -= 1;
        continue;
      }
      if (char === "[") {
        this.brackets += 1;
        this.started = true;
        continue;
      }
      if (char === "]") {
        this.brackets -= 1;
        continue;
      }
      if (!/\s/.test(char)) {
        this.started = true;
      }
    }
  }

  get done(): boolean {
    return this.started && this.quote === null && this.braces <= 0 && this.brackets <= 0;
  }
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

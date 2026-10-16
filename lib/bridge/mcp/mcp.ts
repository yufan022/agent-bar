import { BridgeError } from "../error.ts";
import { readOptional } from "../fsutil.ts";
import { asRecord, parseJsonValue, readJsonObject, writeJson } from "../jsonc.ts";
import type { ToolId, WriteMode } from "../tool.ts";
import { readCodexDocument, writeCodexDocument } from "./codex-toml.ts";
import {
  rewriteEnvClaudeToCursor,
  rewriteEnvClaudeToOpencode,
  rewriteEnvCursorToClaude,
  rewriteEnvOpencodeToClaude,
  rewriteMapValues,
} from "./env-syntax.ts";
import { emptyDocument, type HttpProtocol, type McpDocument, type McpServer } from "./types.ts";

export function readMcp(tool: ToolId, filePath: string): McpDocument {
  switch (tool) {
    case "claude":
    case "cursor":
    case "pi":
    case "omp":
      return readMcpServersJson(filePath, tool);
    case "opencode":
      return readOpencodeMcp(filePath);
    case "codex":
      return readCodexDocument(filePath);
    default: {
      const unreachable: never = tool;
      throw new BridgeError(`unsupported tool id: ${String(unreachable)}`);
    }
  }
}

export function writeMcp(tool: ToolId, filePath: string, doc: McpDocument, mode: WriteMode): void {
  const normalized = normalizeMcpForTool(tool, doc);
  switch (tool) {
    case "claude":
    case "pi":
    case "omp":
      writeClaudeMcp(filePath, normalized, mode);
      return;
    case "cursor":
      writeCursorMcp(filePath, normalized, mode);
      return;
    case "opencode":
      writeOpencodeMcp(filePath, normalized, mode);
      return;
    case "codex":
      writeCodexDocument(filePath, normalized, mode);
      return;
    default: {
      const unreachable: never = tool;
      throw new BridgeError(`unsupported tool id: ${String(unreachable)}`);
    }
  }
}

export function normalizeMcpForTool(tool: ToolId, doc: McpDocument): McpDocument {
  if (tool !== "codex") {
    return structuredClone(doc);
  }
  const servers: Record<string, McpServer> = {};
  for (const name of Object.keys(doc.servers)) {
    const server = doc.servers[name];
    if (server) {
      servers[name] = convertSseToStreamableHttp(server);
    }
  }
  return { servers };
}

export function sseConversionsForCodex(doc: McpDocument): string[] {
  return Object.keys(doc.servers)
    .filter((name) => {
      const server = doc.servers[name];
      return server?.transport.kind === "http" && server.transport.protocol === "sse";
    })
    .sort(compareText);
}

export function mcpDocumentsEqual(left: McpDocument, right: McpDocument): boolean {
  const leftNames = Object.keys(left.servers).sort(compareText);
  const rightNames = Object.keys(right.servers).sort(compareText);
  if (leftNames.length !== rightNames.length) {
    return false;
  }
  for (let index = 0; index < leftNames.length; index += 1) {
    if (leftNames[index] !== rightNames[index]) {
      return false;
    }
    const leftServer = left.servers[leftNames[index] ?? ""];
    const rightServer = right.servers[rightNames[index] ?? ""];
    if (!leftServer || !rightServer || !serversEqual(leftServer, rightServer)) {
      return false;
    }
  }
  return true;
}

export function rewriteSseUrlToStreamableHttp(url: string): string {
  const splitAt = indexOfQueryOrHash(url);
  const pathPart = url.slice(0, splitAt);
  const suffix = url.slice(splitAt);
  const lower = pathPart.toLowerCase();
  let rewritten = pathPart;
  if (lower.endsWith("/sse/")) {
    rewritten = `${pathPart.slice(0, -4)}mcp/`;
  } else if (lower.endsWith("/sse")) {
    rewritten = `${pathPart.slice(0, -3)}mcp`;
  }
  return `${rewritten}${suffix}`;
}

function convertSseToStreamableHttp(server: McpServer): McpServer {
  if (server.transport.kind === "http" && server.transport.protocol === "sse") {
    return {
      name: server.name,
      transport: {
        kind: "http",
        url: rewriteSseUrlToStreamableHttp(server.transport.url),
        headers: { ...server.transport.headers },
        protocol: "streamable-http",
      },
    };
  }
  return structuredClone(server);
}

function indexOfQueryOrHash(url: string): number {
  const query = url.indexOf("?");
  const hash = url.indexOf("#");
  if (query === -1) {
    return hash === -1 ? url.length : hash;
  }
  if (hash === -1) {
    return query;
  }
  return Math.min(query, hash);
}

function readMcpServersJson(filePath: string, tool: ToolId): McpDocument {
  const raw = readOptional(filePath);
  if (raw === null) {
    return emptyDocument();
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BridgeError(`failed to parse JSON at ${filePath}: ${message}`);
  }
  const root = asRecord(value);
  if (!root) {
    throw new BridgeError(`invalid MCP config at ${filePath}: root must be a JSON object`);
  }
  if (!Object.prototype.hasOwnProperty.call(root, "mcpServers")) {
    return emptyDocument();
  }
  const serversObj = asRecord(root.mcpServers);
  if (!serversObj) {
    throw new BridgeError(`invalid MCP config at ${filePath}: mcpServers must be an object`);
  }
  const servers: Record<string, McpServer> = {};
  for (const name of Object.keys(serversObj)) {
    servers[name] = parseJsonServer(filePath, name, serversObj[name], tool);
  }
  return { servers };
}

function parseJsonServer(filePath: string, name: string, entry: unknown, tool: ToolId): McpServer {
  const object = asRecord(entry);
  if (!object) {
    throw new BridgeError(`invalid MCP config at ${filePath}: server '${name}' must be an object`);
  }
  if (typeof object.url === "string") {
    let headers = extractStringMap(object.headers) ?? {};
    if (tool === "cursor") {
      headers = rewriteMapValues(headers, rewriteEnvCursorToClaude);
    }
    const protocol = parseHttpProtocol(
      typeof object.type === "string"
        ? object.type
        : typeof object.transport === "string"
          ? object.transport
          : null,
    );
    return {
      name,
      transport: { kind: "http", url: object.url, headers, protocol },
    };
  }
  if (typeof object.command !== "string") {
    throw new BridgeError(
      `invalid MCP config at ${filePath}: server '${name}' needs 'command' (stdio) or 'url' (http)`,
    );
  }
  let env = extractStringMap(object.env) ?? {};
  if (tool === "cursor") {
    env = rewriteMapValues(env, rewriteEnvCursorToClaude);
  }
  return {
    name,
    transport: {
      kind: "stdio",
      command: object.command,
      args: extractStringVec(object.args) ?? [],
      env,
    },
  };
}

function parseHttpProtocol(typeField: string | null): HttpProtocol {
  switch (typeField?.trim().toLowerCase()) {
    case "sse":
      return "sse";
    case "http":
    case "streamable-http":
    case "streamable_http":
      return "streamable-http";
    default:
      return "streamable-http";
  }
}

function httpProtocolTypeName(protocol: HttpProtocol): string {
  return protocol === "sse" ? "sse" : "http";
}

function writeClaudeMcp(filePath: string, doc: McpDocument, mode: WriteMode): void {
  const root = readJsonObject(filePath);
  const servers = mergeMcpServersJson(root.mcpServers, doc, mode, serverToClaudeJson);
  delete root.mcpServers;
  root.mcpServers = servers;
  writeJson(filePath, root);
}

function writeCursorMcp(filePath: string, doc: McpDocument, mode: WriteMode): void {
  const root = readJsonObject(filePath);
  const servers = mergeMcpServersJson(root.mcpServers, doc, mode, serverToCursorJson);
  delete root.mcpServers;
  root.mcpServers = servers;
  writeJson(filePath, root);
}

function mergeMcpServersJson(
  existing: unknown,
  doc: McpDocument,
  mode: WriteMode,
  encode: (server: McpServer) => Record<string, unknown>,
): Record<string, unknown> {
  const map = asRecord(existing) ? { ...asRecord(existing) } : {};
  if (mode === "prune") {
    for (const key of Object.keys(map)) {
      if (!Object.prototype.hasOwnProperty.call(doc.servers, key)) {
        delete map[key];
      }
    }
  }
  for (const name of Object.keys(doc.servers).sort(compareText)) {
    const server = doc.servers[name];
    if (server) {
      map[name] = encode(server);
    }
  }
  return map;
}

function serverToClaudeJson(server: McpServer): Record<string, unknown> {
  if (server.transport.kind === "stdio") {
    const object: Record<string, unknown> = { command: server.transport.command };
    if (server.transport.args.length > 0) {
      object.args = [...server.transport.args];
    }
    if (Object.keys(server.transport.env).length > 0) {
      object.env = { ...server.transport.env };
    }
    return object;
  }
  const object: Record<string, unknown> = {
    type: httpProtocolTypeName(server.transport.protocol),
    url: server.transport.url,
  };
  if (Object.keys(server.transport.headers).length > 0) {
    object.headers = { ...server.transport.headers };
  }
  return object;
}

function serverToCursorJson(server: McpServer): Record<string, unknown> {
  if (server.transport.kind === "stdio") {
    const env = rewriteMapValues(server.transport.env, rewriteEnvClaudeToCursor);
    const object: Record<string, unknown> = { command: server.transport.command };
    if (server.transport.args.length > 0) {
      object.args = [...server.transport.args];
    }
    if (Object.keys(env).length > 0) {
      object.env = env;
    }
    return object;
  }
  const headers = rewriteMapValues(server.transport.headers, rewriteEnvClaudeToCursor);
  const object: Record<string, unknown> = {
    type: httpProtocolTypeName(server.transport.protocol),
    url: server.transport.url,
  };
  if (Object.keys(headers).length > 0) {
    object.headers = headers;
  }
  return object;
}

function readOpencodeMcp(filePath: string): McpDocument {
  const raw = readOptional(filePath);
  if (raw === null) {
    return emptyDocument();
  }
  const value = parseJsonValue(filePath, raw);
  const root = asRecord(value);
  if (!root) {
    throw new BridgeError(`invalid MCP config at ${filePath}: root must be a JSON object`);
  }
  if (!Object.prototype.hasOwnProperty.call(root, "mcp")) {
    return emptyDocument();
  }
  const mcp = asRecord(root.mcp);
  if (!mcp) {
    throw new BridgeError(`invalid MCP config at ${filePath}: mcp must be an object`);
  }
  const servers: Record<string, McpServer> = {};
  for (const name of Object.keys(mcp)) {
    servers[name] = parseOpencodeServer(filePath, name, mcp[name]);
  }
  return { servers };
}

function parseOpencodeServer(filePath: string, name: string, entry: unknown): McpServer {
  const object = asRecord(entry);
  if (!object) {
    throw new BridgeError(`invalid MCP config at ${filePath}: server '${name}' must be an object`);
  }
  let typeName = typeof object.type === "string" ? object.type : "";
  if (!typeName) {
    typeName = typeof object.url === "string" ? "remote" : "local";
  }
  if (typeName === "remote" || typeName === "sse" || typeName === "http") {
    if (typeof object.url !== "string") {
      throw new BridgeError(
        `invalid MCP config at ${filePath}: remote server '${name}' needs url`,
      );
    }
    const headers = rewriteMapValues(
      extractStringMap(object.headers) ?? {},
      rewriteEnvOpencodeToClaude,
    );
    const protocol: HttpProtocol = typeName === "sse" ? "sse" : "streamable-http";
    return {
      name,
      transport: { kind: "http", url: object.url, headers, protocol },
    };
  }
  if (object.command === undefined) {
    throw new BridgeError(
      `invalid MCP config at ${filePath}: local server '${name}' needs command array`,
    );
  }
  let command = "";
  let args: string[] = [];
  if (Array.isArray(object.command)) {
    const parts = object.command.filter((item): item is string => typeof item === "string");
    const head = parts[0];
    if (!head) {
      throw new BridgeError(
        `invalid MCP config at ${filePath}: server '${name}' command array is empty`,
      );
    }
    command = head;
    args = parts.slice(1);
  } else if (typeof object.command === "string") {
    command = object.command;
  } else {
    throw new BridgeError(
      `invalid MCP config at ${filePath}: server '${name}' command must be array or string`,
    );
  }
  const env = rewriteMapValues(
    extractStringMap(object.environment) ?? extractStringMap(object.env) ?? {},
    rewriteEnvOpencodeToClaude,
  );
  return { name, transport: { kind: "stdio", command, args, env } };
}

function writeOpencodeMcp(filePath: string, doc: McpDocument, mode: WriteMode): void {
  const root = readJsonObject(filePath);
  const map = asRecord(root.mcp) ? { ...asRecord(root.mcp) } : {};
  if (mode === "prune") {
    for (const key of Object.keys(map)) {
      if (!Object.prototype.hasOwnProperty.call(doc.servers, key)) {
        delete map[key];
      }
    }
  }
  for (const name of Object.keys(doc.servers).sort(compareText)) {
    const server = doc.servers[name];
    if (server) {
      map[name] = serverToOpencodeJson(server);
    }
  }
  delete root.mcp;
  root.mcp = map;
  writeJson(filePath, root);
}

function serverToOpencodeJson(server: McpServer): Record<string, unknown> {
  if (server.transport.kind === "stdio") {
    const env = rewriteMapValues(server.transport.env, rewriteEnvClaudeToOpencode);
    const object: Record<string, unknown> = {
      type: "local",
      command: [server.transport.command, ...server.transport.args],
    };
    if (Object.keys(env).length > 0) {
      object.environment = env;
    }
    return object;
  }
  const headers = rewriteMapValues(server.transport.headers, rewriteEnvClaudeToOpencode);
  const object: Record<string, unknown> = {
    type: "remote",
    url: server.transport.url,
  };
  if (Object.keys(headers).length > 0) {
    object.headers = headers;
  }
  return object;
}

function extractStringMap(value: unknown): Record<string, string> | null {
  const object = asRecord(value);
  if (!object) {
    return null;
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

function extractStringVec(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function serversEqual(left: McpServer, right: McpServer): boolean {
  if (left.name !== right.name || left.transport.kind !== right.transport.kind) {
    return false;
  }
  if (left.transport.kind === "stdio" && right.transport.kind === "stdio") {
    return (
      left.transport.command === right.transport.command &&
      arraysEqual(left.transport.args, right.transport.args) &&
      recordsEqual(left.transport.env, right.transport.env)
    );
  }
  if (left.transport.kind === "http" && right.transport.kind === "http") {
    return (
      left.transport.url === right.transport.url &&
      left.transport.protocol === right.transport.protocol &&
      recordsEqual(left.transport.headers, right.transport.headers)
    );
  }
  return false;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function recordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort(compareText);
  const rightKeys = Object.keys(right).sort(compareText);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
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

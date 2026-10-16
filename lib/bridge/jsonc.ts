import { BridgeError, errorMessage } from "./error.ts";
import { readOptional } from "./fsutil.ts";
import { atomicWrite } from "./fsutil.ts";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function stripJsoncLineComments(input: string): string {
  let out = "";
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const body = hasTrailingNewline ? normalized.slice(0, -1) : normalized;
  const lines = body === "" ? [] : body.split("\n");
  for (const line of lines) {
    let inString = false;
    let escaped = false;
    let cut = line.length;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
      } else if (char === '"') {
        inString = true;
      } else if (char === "/" && line[index + 1] === "/") {
        cut = index;
        break;
      }
    }
    out += `${line.slice(0, cut).trimEnd()}\n`;
  }
  return out;
}

export function readJsonObject(filePath: string): Record<string, unknown> {
  const raw = readOptional(filePath);
  if (raw === null || raw.trim() === "") {
    return {};
  }
  const value = parseJsonValue(filePath, raw);
  const object = asRecord(value);
  if (!object) {
    throw new BridgeError(`invalid MCP config at ${filePath}: root must be a JSON object`);
  }
  return object;
}

export function parseJsonValue(filePath: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    try {
      return JSON.parse(stripJsoncLineComments(raw)) as unknown;
    } catch (error) {
      throw new BridgeError(`failed to parse JSON at ${filePath}: ${errorMessage(error)}`);
    }
  }
}

export function writeJson(filePath: string, value: unknown): void {
  let pretty = JSON.stringify(value, null, 2);
  if (!pretty.endsWith("\n")) {
    pretty += "\n";
  }
  atomicWrite(filePath, pretty);
}

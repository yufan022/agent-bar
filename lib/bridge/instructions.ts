import { atomicWrite, readOptional } from "./fsutil.ts";
import { ensureSymlink, resolveRealPath, type LinkAction } from "./symlink.ts";

export function readInstructions(filePath: string): string | null {
  return readOptional(filePath);
}

export function writeInstructions(filePath: string, body: string): void {
  atomicWrite(filePath, normalizeTrailingNewline(body));
}

export function instructionsRealPath(filePath: string): string | null {
  return resolveRealPath(filePath);
}

export function linkInstructions(
  linkPath: string,
  sourcePath: string,
  force: boolean,
): LinkAction {
  return ensureSymlink(linkPath, sourcePath, force, "instructions");
}

function normalizeTrailingNewline(body: string): string {
  if (body.length > 0 && !body.endsWith("\n")) {
    return `${body}\n`;
  }
  return body;
}

export function instructionsDiff(
  fromLabel: string,
  toLabel: string,
  from: string,
  to: string,
): string {
  if (from === to) {
    return "";
  }
  const oldLines = splitDiffLines(to);
  const newLines = splitDiffLines(from);
  let out = `--- ${toLabel}\n+++ ${fromLabel}\n`;
  out += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
  for (const line of oldLines) {
    out += `-${line}\n`;
  }
  for (const line of newLines) {
    out += `+${line}\n`;
  }
  return out;
}

export function formatInstructionsComparison(
  fromLabel: string,
  toLabel: string,
  fromPath: string | null,
  toPath: string | null,
  fromReal: string | null,
  toReal: string | null,
  fromBody: string,
  toBody: string,
): string {
  if (fromReal === toReal) {
    if (fromReal !== null) {
      return `(identical)\n  real_path: ${fromReal}\n`;
    }
    return "(identical; both missing)\n";
  }

  let out = `  ${fromLabel}: ${displayResolved(fromPath, fromReal)}\n`;
  out += `  ${toLabel}: ${displayResolved(toPath, toReal)}\n`;
  if (fromBody.trimEnd() === toBody.trimEnd()) {
    out += "(content identical; paths differ)\n";
    return out;
  }
  const diff = instructionsDiff(fromLabel, toLabel, fromBody, toBody);
  if (diff.trim() === "") {
    out += "(content identical; paths differ)\n";
    return out;
  }
  out += diff;
  if (!out.endsWith("\n")) {
    out += "\n";
  }
  return out;
}

function displayResolved(configured: string | null, real: string | null): string {
  if (real !== null) {
    return real;
  }
  if (configured !== null) {
    return `${configured} (missing)`;
  }
  return "(unsupported)";
}

function splitDiffLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const parts = text.split("\n");
  if (text.endsWith("\n")) {
    parts.pop();
  }
  return parts;
}

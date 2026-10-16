import fs from "node:fs";
import path from "node:path";
import { ioError, isNotFound } from "./error.ts";
import { ensureParent } from "./paths.ts";

export function atomicWrite(filePath: string, contents: string): void {
  ensureParent(filePath);
  const parent = path.dirname(filePath);
  const fileName = path.basename(filePath) || "tmp";
  const tmpPath = path.join(parent, `.${fileName}.agent-bridge.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, "w");
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== null) {
      fs.closeSync(fd);
      fd = null;
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // The temp file may not exist if opening it failed.
    }
    throw ioError(tmpPath, error);
  }
  if (fd !== null) {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup after a failed rename.
    }
    throw ioError(filePath, error);
  }
}

export function readOptional(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw ioError(filePath, error);
  }
}

import fs from "node:fs";
import path from "node:path";
import { BridgeError, ioError, isNotFound } from "./error.ts";
import { ensureParent } from "./paths.ts";

export type LinkAction = "Created" | "Unchanged";

export function ensureSymlink(
  linkPath: string,
  sourcePath: string,
  force: boolean,
  conflictName: string,
): LinkAction {
  let sourceReal: string;
  try {
    sourceReal = fs.realpathSync(sourcePath);
  } catch (error) {
    throw ioError(sourcePath, error);
  }

  let meta: fs.Stats | null = null;
  try {
    meta = fs.lstatSync(linkPath);
  } catch (error) {
    if (!isNotFound(error)) {
      throw ioError(linkPath, error);
    }
  }

  if (meta) {
    if (meta.isSymbolicLink()) {
      let current: string;
      try {
        current = fs.readlinkSync(linkPath);
      } catch (error) {
        throw ioError(linkPath, error);
      }
      try {
        const resolved = resolveLinkTarget(linkPath, current);
        if (resolved === sourceReal) {
          return "Unchanged";
        }
      } catch {
        // A dangling or unreadable link is replaced only when force is set.
      }
      if (!force) {
        throw linkConflict(
          conflictName,
          linkPath,
          "symlink exists and points elsewhere (use --force to replace)",
        );
      }
      try {
        fs.unlinkSync(linkPath);
      } catch (error) {
        throw ioError(linkPath, error);
      }
    } else if (meta.isDirectory()) {
      if (!force) {
        throw linkConflict(
          conflictName,
          linkPath,
          "real directory exists (use --force to replace with symlink)",
        );
      }
      try {
        fs.rmSync(linkPath, { recursive: true, force: false });
      } catch (error) {
        throw ioError(linkPath, error);
      }
    } else {
      if (!force) {
        throw linkConflict(
          conflictName,
          linkPath,
          "path exists and is not a symlink (use --force to replace)",
        );
      }
      try {
        fs.unlinkSync(linkPath);
      } catch (error) {
        throw ioError(linkPath, error);
      }
    }
  }

  ensureParent(linkPath);
  try {
    fs.symlinkSync(sourceReal, linkPath);
  } catch (error) {
    throw ioError(linkPath, error);
  }
  return "Created";
}

export function resolveRealPath(filePath: string): string | null {
  try {
    fs.lstatSync(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw ioError(filePath, error);
  }
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

export function resolveLinkTarget(linkPath: string, current: string): string {
  const absolute = path.isAbsolute(current)
    ? current
    : path.resolve(path.dirname(linkPath), current);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    throw ioError(absolute, error);
  }
}

function linkConflict(name: string, filePath: string, message: string): BridgeError {
  return new BridgeError(`link conflict for '${name}' at ${filePath}: ${message}`);
}

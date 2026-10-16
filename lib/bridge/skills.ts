import fs from "node:fs";
import path from "node:path";
import { ioError } from "./error.ts";
import { ensureSymlink, resolveLinkTarget, type LinkAction } from "./symlink.ts";

export type { LinkAction };

export interface SkillEntry {
  name: string;
  realPath: string;
}

export function listSkills(skillsDir: string): SkillEntry[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  let names: string[];
  try {
    names = fs.readdirSync(skillsDir);
  } catch (error) {
    throw ioError(skillsDir, error);
  }
  const entries: SkillEntry[] = [];
  for (const name of names) {
    const skillPath = path.join(skillsDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(skillPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    const skillMd = path.join(skillPath, "SKILL.md");
    let skillStat: fs.Stats;
    try {
      skillStat = fs.statSync(skillMd);
    } catch {
      continue;
    }
    if (!skillStat.isFile()) {
      continue;
    }
    let realPath: string;
    try {
      realPath = fs.realpathSync(skillPath);
    } catch (error) {
      throw ioError(skillPath, error);
    }
    entries.push({ name, realPath });
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  return entries;
}

export function linkSkill(linkPath: string, sourceRealPath: string, force: boolean): LinkAction {
  const name = path.basename(linkPath) || "?";
  return ensureSymlink(linkPath, sourceRealPath, force, name);
}

export function listOrphanSkillLinks(
  skillsDir: string,
  keep: ReadonlySet<string>,
  sourceSkillsRoot: string | null,
): string[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  let names: string[];
  try {
    names = fs.readdirSync(skillsDir);
  } catch (error) {
    throw ioError(skillsDir, error);
  }
  const orphans: string[] = [];
  for (const name of names) {
    if (keep.has(name)) {
      continue;
    }
    const linkPath = path.join(skillsDir, name);
    let meta: fs.Stats;
    try {
      meta = fs.lstatSync(linkPath);
    } catch {
      continue;
    }
    if (!meta.isSymbolicLink()) {
      continue;
    }
    if (sourceSkillsRoot !== null) {
      try {
        const target = fs.readlinkSync(linkPath);
        if (!linkAttributableToSource(linkPath, target, sourceSkillsRoot)) {
          continue;
        }
      } catch {
        // Unreadable symlink targets are treated as orphans when pruning.
      }
    }
    orphans.push(name);
  }
  orphans.sort(compareText);
  return orphans;
}

export function pruneSkillLinks(
  skillsDir: string,
  keep: ReadonlySet<string>,
  sourceSkillsRoot: string | null,
): string[] {
  const orphans = listOrphanSkillLinks(skillsDir, keep, sourceSkillsRoot);
  const removed: string[] = [];
  for (const name of orphans) {
    const linkPath = path.join(skillsDir, name);
    try {
      fs.unlinkSync(linkPath);
    } catch (error) {
      throw ioError(linkPath, error);
    }
    removed.push(name);
  }
  return removed;
}

export function skillFileCount(skillDir: string): number {
  return countFiles(skillDir);
}

function countFiles(dirPath: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const child = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(child);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function linkAttributableToSource(linkPath: string, target: string, sourceSkillsRoot: string): boolean {
  try {
    return pathUnderRoot(resolveLinkTarget(linkPath, target), sourceSkillsRoot);
  } catch {
    return pathUnderRoot(absoluteLinkTarget(linkPath, target), sourceSkillsRoot);
  }
}

function absoluteLinkTarget(linkPath: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(path.dirname(linkPath), target);
}

function pathUnderRoot(candidate: string, root: string): boolean {
  if (isPathInside(candidate, root)) {
    return true;
  }
  try {
    return isPathInside(candidate, fs.realpathSync(root));
  } catch {
    return false;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { SessionWarning } from "../../src/lib/session/contracts.js";
import { normalizePathForId } from "./path-utils.js";

export interface JsonLineEntry<T = unknown> {
  line: number;
  value: T;
}

export interface SessionFileRecord {
  path: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
  updatedAt: string | null;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readTextFile(filePath)) as T;
}

export async function readJsonLines<T = unknown>(
  filePath: string,
): Promise<{ entries: JsonLineEntry<T>[]; warnings: SessionWarning[] }> {
  const text = await readTextFile(filePath);
  const entries: JsonLineEntry<T>[] = [];
  const warnings: SessionWarning[] = [];

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    try {
      entries.push({
        line: index + 1,
        value: JSON.parse(trimmed) as T,
      });
    } catch {
      warnings.push({
        code: "invalid_json_line",
        message: "Skipped malformed JSON line during readonly parse.",
        filePath,
        line: index + 1,
      });
    }
  }

  return { entries, warnings };
}

export async function listFilesRecursive(
  rootPath: string,
  predicate: (filePath: string) => boolean,
): Promise<SessionFileRecord[]> {
  const found: SessionFileRecord[] = [];

  if (!(await pathExists(rootPath))) {
    return found;
  }

  await walkDirectory(rootPath, async (filePath) => {
    if (!predicate(filePath)) {
      return;
    }

    const stats = await stat(filePath);
    found.push({
      path: filePath,
      relativePath: normalizePathForId(relative(rootPath, filePath)),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  });

  found.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  );

  return found;
}

export async function findSiblingText(
  filePath: string,
  siblingName: string,
): Promise<string | null> {
  const siblingPath = join(dirname(filePath), siblingName);
  if (!(await pathExists(siblingPath))) {
    return null;
  }

  return readTextFile(siblingPath);
}

async function walkDirectory(
  rootPath: string,
  onFile: (filePath: string) => Promise<void>,
): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const sorted = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );

  for (const entry of sorted) {
    const entryPath = join(rootPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(entryPath, onFile);
      continue;
    }

    if (entry.isFile()) {
      await onFile(entryPath);
    }
  }
}

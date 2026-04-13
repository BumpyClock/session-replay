import { basename, sep } from "node:path";

export function normalizePathForId(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

export function basenameWithoutExtension(filePath: string): string {
  const base = basename(filePath);
  const dotIndex = base.lastIndexOf(".");
  return dotIndex === -1 ? base : base.slice(0, dotIndex);
}

export function lastPathSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts.at(-1) ?? null : null;
}

export function decodeAgentProjectDirectory(dirName: string): string | null {
  if (!dirName) {
    return null;
  }

  if (!dirName.startsWith("-")) {
    return null;
  }

  const parts = dirName.split("-").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  return `${sep}${parts.join(sep)}`;
}

import * as fs from "fs/promises";
import path from "path";
import type { Dirent } from "fs";

/**
 * Robustly determine what a directory entry really is.
 *
 * `fs.readdir(dir, { withFileTypes: true })` reports each entry's type from the
 * filesystem's `d_type` field, which is unreliable in two situations this app
 * hits in the wild:
 *
 *  - **Symlinks:** a symlink reports `isSymbolicLink()` and neither `isFile()`
 *    nor `isDirectory()`, so a symlinked folder (e.g. retronas symlinks CD/DVD/
 *    POPS) looks like "nothing" and gets skipped.
 *  - **Network filesystems:** SMB/CIFS, NFS and some FUSE mounts frequently
 *    don't populate `d_type` at all — the kernel returns `DT_UNKNOWN`, so every
 *    `isX()` method returns `false` and the whole share scans as empty.
 *
 * When the Dirent already knows it's a plain file or directory we trust it;
 * otherwise we fall back to a `stat` of the actual path to get the truth.
 *
 * @param follow  When `true` (default) a symlink is resolved to its target via
 *   `fs.stat` — used by scans that should see *through* symlinked folders.
 *   When `false` the entry's own type is used via `fs.lstat`, so a symlink is
 *   reported as `"other"` (a leaf, not followed) — used by recursive deletes
 *   that must never descend into a link's target.
 */
export async function resolveEntryType(
  entry: Dirent,
  parentDir: string,
  opts: { follow?: boolean } = {}
): Promise<"file" | "directory" | "other"> {
  const follow = opts.follow !== false;

  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink() && !follow) return "other";

  // Symlink target (follow) or DT_UNKNOWN — ask the filesystem directly.
  try {
    const fullPath = path.join(parentDir, entry.name);
    const stats = follow ? await fs.stat(fullPath) : await fs.lstat(fullPath);
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch {
    return "other";
  }
}

/** True if `entry` is (or points at) a directory. Follows symlinks. */
export async function isDirectoryEntry(
  entry: Dirent,
  parentDir: string
): Promise<boolean> {
  return (await resolveEntryType(entry, parentDir)) === "directory";
}

/** True if `entry` is (or points at) a regular file. Follows symlinks. */
export async function isFileEntry(
  entry: Dirent,
  parentDir: string
): Promise<boolean> {
  return (await resolveEntryType(entry, parentDir)) === "file";
}

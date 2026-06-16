import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("apps");

/**
 * Homebrew "APPS" support.
 *
 * OPL launches homebrew from the `APPS/` folder: each app lives in its own
 * subfolder containing a `title.cfg` (`title=...` / `boot=<file>.ELF`) and the
 * ELF it points to. This module enumerates those folders and imports new ones.
 */

export interface AppInfo {
  /** Subfolder name under APPS/ (used as the stable id / delete key). */
  folder: string;
  title: string;
  boot: string;
  /** Absolute path to the boot ELF, when it exists. */
  path: string;
  sizeBytes: number;
}

function appsDir(oplRoot: string): string {
  return path.join(oplRoot, "APPS");
}

function sanitizeAppName(name: string): string {
  return (
    name
      .trim()
      .replace(/\.elf$/i, "")
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .slice(0, 48)
      .trim() || "App"
  );
}

function parseTitleCfg(raw: string): { title?: string; boot?: string } {
  const out: { title?: string; boot?: string } = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key === "title") out.title = val;
    else if (key === "boot") out.boot = val;
  }
  return out;
}

export async function getApps(
  oplRoot: string
): Promise<{ success: boolean; apps: AppInfo[]; message?: string }> {
  try {
    const dir = appsDir(oplRoot);
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const apps: AppInfo[] = [];

    for (const item of items) {
      if (!item.isDirectory()) continue;
      // Skip POPStarter launchers for PS1 games — those folders are created
      // alongside each PS1 VCD and are already represented by their PS1 entry
      // in the library. Showing them here would duplicate every PS1 title.
      if (/^POPS_/i.test(item.name)) continue;
      const folderPath = path.join(dir, item.name);

      let title = item.name;
      let boot = "";
      try {
        const cfg = parseTitleCfg(
          await fs.readFile(path.join(folderPath, "title.cfg"), "utf-8")
        );
        if (cfg.title) title = cfg.title;
        if (cfg.boot) boot = cfg.boot;
      } catch {
        // No title.cfg — fall back to the first ELF in the folder.
      }

      if (!boot) {
        const elf = (await fs.readdir(folderPath).catch(() => [])).find((f) =>
          /\.elf$/i.test(f)
        );
        if (!elf) continue; // not a launchable app folder
        boot = elf;
      }

      const elfPath = path.join(folderPath, boot);
      let sizeBytes = 0;
      try {
        sizeBytes = (await fs.stat(elfPath)).size;
      } catch {
        continue; // boot target missing — skip
      }

      apps.push({ folder: item.name, title, boot, path: elfPath, sizeBytes });
    }

    apps.sort((a, b) => a.title.localeCompare(b.title));
    log.verbose(`Found ${apps.length} homebrew app(s) in ${dir}`);
    return { success: true, apps };
  } catch (err: any) {
    log.error(`Failed to enumerate apps in ${appsDir(oplRoot)}:`, err?.message || err);
    return { success: false, apps: [], message: err?.message || String(err) };
  }
}

export async function importApp(
  oplRoot: string,
  elfPath: string,
  title: string
): Promise<{ success: boolean; folder?: string; message?: string }> {
  try {
    const folderName = sanitizeAppName(title || path.basename(elfPath));
    const targetDir = path.join(appsDir(oplRoot), folderName);

    try {
      await fs.access(targetDir);
      log.warn(`App folder "${folderName}" already exists — import aborted`);
      return { success: false, message: `An app folder "${folderName}" already exists.` };
    } catch {
      // good — does not exist
    }

    log.info(`Importing homebrew app "${title || folderName}" from ${elfPath}`);
    await fs.mkdir(targetDir, { recursive: true });
    const elfBase = path.basename(elfPath);
    await fs.copyFile(elfPath, path.join(targetDir, elfBase));
    await fs.writeFile(
      path.join(targetDir, "title.cfg"),
      `title=${title || folderName}\nboot=${elfBase}\n`,
      "utf-8"
    );
    log.info(`Imported app into APPS/${folderName} (boot=${elfBase})`);
    return { success: true, folder: folderName };
  } catch (err: any) {
    log.error(`Failed to import app from ${elfPath}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

export async function deleteApp(
  oplRoot: string,
  folder: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Guard against path traversal — only a direct child of APPS/ is allowed.
    if (!folder || folder.includes("/") || folder.includes("\\") || folder.includes("..")) {
      log.warn(`Rejected app delete for suspicious folder name: "${folder}"`);
      return { success: false, message: "Invalid app folder." };
    }
    await fs.rm(path.join(appsDir(oplRoot), folder), {
      recursive: true,
      force: true,
    });
    log.info(`Deleted app APPS/${folder}`);
    return { success: true };
  } catch (err: any) {
    log.error(`Failed to delete app APPS/${folder}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

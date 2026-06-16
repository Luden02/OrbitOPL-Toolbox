import { app } from "electron";
import fs from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("settings");

/**
 * Persisted application settings. Stored as JSON in the Electron userData
 * directory so they survive across launches.
 */
export interface AppSettings {
  /** Last mounted OPL library root directory. */
  lastDirectory?: string;
  /** Re-mount the last directory automatically on launch. */
  autoReconnect: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  lastDirectory: undefined,
  autoReconnect: true,
};

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function getSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Merge over defaults so newly-added settings have sane values.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    // Missing or unreadable file — fall back to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): AppSettings {
  const settings = getSettings();
  settings[key] = value;
  try {
    fs.writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2));
    log.verbose(`Persisted setting "${String(key)}" = ${JSON.stringify(value)}`);
  } catch (error) {
    log.error(`Failed to persist setting "${String(key)}":`, error);
  }
  return settings;
}

export function directoryExists(dirPath: string): boolean {
  try {
    return !!dirPath && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

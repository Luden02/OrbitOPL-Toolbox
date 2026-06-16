import type { BrowserWindow } from "electron";

/**
 * Main-process structured logger.
 *
 * Every entry is (1) printed to the terminal with a `[LEVEL] [scope]` prefix and
 * (2) forwarded to the renderer's in-app Logs viewer over the "main-log" IPC
 * channel. VRB ("verbose") entries are only shown there when the user turns on
 * Verbose mode — use them to narrate the fine-grained work each routine does so
 * that "any type of work" is observable when troubleshooting.
 *
 * Terminal output goes through console references captured at module load,
 * *before* main.ts wraps console.* for its stray-output forwarder. That keeps a
 * logger entry from being forwarded twice (once by us, once by the wrapper).
 */

export type MainLogLevel = "INF" | "ERR" | "VRB";

const terminal = {
  log: console.log.bind(console),
  error: console.error.bind(console),
};

let targetWindow: BrowserWindow | null = null;

/** Point the logger at the renderer window that hosts the Logs viewer. */
export function setLogWindow(win: BrowserWindow | null): void {
  targetWindow = win;
}

function forward(level: MainLogLevel, location: string, message: string): void {
  try {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send("main-log", {
        level,
        location,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Logging must never throw into the work it's describing.
  }
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function format(args: unknown[]): string {
  return args.map(stringifyArg).join(" ");
}

/** Human-readable byte size for log messages (e.g. "1.4 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export interface Logger {
  /** Milestone or outcome — always visible. */
  info(...args: unknown[]): void;
  /** Recoverable / noteworthy problem — shown as an info line, flagged. */
  warn(...args: unknown[]): void;
  /** Failure — always visible, rendered in red. */
  error(...args: unknown[]): void;
  /** Step-by-step work — only visible when Verbose mode is enabled. */
  verbose(...args: unknown[]): void;
}

/**
 * Build a logger bound to a `scope` (the routine/domain doing the work). The
 * scope shows up in the Logs viewer's location column, e.g. `createLogger("zso")`.
 */
export function createLogger(scope: string): Logger {
  return {
    info(...args) {
      const msg = format(args);
      terminal.log(`[INF] [${scope}] ${msg}`);
      forward("INF", scope, msg);
    },
    warn(...args) {
      const msg = format(args);
      terminal.log(`[WRN] [${scope}] ${msg}`);
      forward("INF", scope, `⚠ ${msg}`);
    },
    error(...args) {
      const msg = format(args);
      terminal.error(`[ERR] [${scope}] ${msg}`);
      forward("ERR", scope, msg);
    },
    verbose(...args) {
      const msg = format(args);
      terminal.log(`[VRB] [${scope}] ${msg}`);
      forward("VRB", scope, msg);
    },
  };
}

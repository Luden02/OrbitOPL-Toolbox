/**
 * HDD facade — the IPC-facing surface for PS2 APA/HDL disk support.
 *
 * Owns the single active connection (one BlockDevice: OPL's NBD server over
 * the network, or — in a later milestone — a locally attached drive via the
 * elevated helper), the cached partition map, and the operation mutex that
 * keeps disk mutations serialized. All APA/HDL logic lives in src/hdd/.
 *
 * Safety model: connections degrade to read-only rather than failing hard.
 * A disk without a valid Sony MBR header, a partition chain with anomalies,
 * or a ToxicOS 2-slice layout can still be inspected, but every mutating
 * entry point refuses until the disk verifies clean.
 */

import { BlockDevice } from "./hdd/block-device";
import { NbdBlockDevice } from "./hdd/nbd/nbd-client";
import { readPartitionMap, verifyApaRoot } from "./hdd/apa/apa-reader";
import { PartitionMap } from "./hdd/apa/apa-types";
import { buildChunkMap } from "./hdd/apa/apa-allocator";
import { HdlGame, listHdlGames } from "./hdd/apa/hdl-meta";
import { createLogger, formatBytes } from "./logger";

const log = createLogger("hdd");

export type HddTarget =
  | { kind: "nbd"; host: string; port?: number }
  | { kind: "local"; devicePath: string };

export interface HddInfo {
  label: string;
  sizeBytes: number;
  freeBytes: number;
  readOnly: boolean;
  /** Present when the connection was degraded to read-only. */
  readOnlyReason?: string;
  problems: string[];
}

export interface HddStatus {
  connected: boolean;
  target?: HddTarget;
  info?: HddInfo;
  /** Name of the operation currently holding the mutex, if any. */
  busy: string | null;
}

interface HddSession {
  device: BlockDevice;
  target: HddTarget;
  label: string;
  map: PartitionMap | null;
  readOnly: boolean;
  readOnlyReason?: string;
}

let session: HddSession | null = null;
let busyOperation: string | null = null;

/** Serializes every disk operation; concurrent callers get a clear refusal. */
async function withLock<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  if (busyOperation !== null) {
    throw new Error(`Another HDD operation is in progress (${busyOperation}).`);
  }
  busyOperation = operation;
  try {
    return await fn();
  } finally {
    busyOperation = null;
  }
}

function targetLabel(target: HddTarget): string {
  return target.kind === "nbd"
    ? `${target.host}:${target.port ?? 10809} (OPL NBD)`
    : target.devicePath;
}

function sessionInfo(s: HddSession): HddInfo {
  const freeBytes = s.map ? buildChunkMap(s.map).freeChunks * 128 * 1024 * 1024 : 0;
  return {
    label: s.label,
    sizeBytes: s.device.sizeBytes,
    freeBytes,
    readOnly: s.readOnly,
    readOnlyReason: s.readOnlyReason,
    problems: s.map?.problems.map((p) => p.message) ?? [],
  };
}

export async function hddConnect(
  target: HddTarget
): Promise<{ success: boolean; info?: HddInfo; message?: string }> {
  try {
    return await withLock("connect", async () => {
      if (session) {
        await closeSession();
      }
      log.info(`Connecting to ${targetLabel(target)}`);

      let device: BlockDevice;
      if (target.kind === "nbd") {
        device = await NbdBlockDevice.connect({
          host: target.host,
          port: target.port,
          exportName: "hdd0",
        });
      } else {
        throw new Error("Local device support is not available yet.");
      }

      const s: HddSession = {
        device,
        target,
        label: targetLabel(target),
        map: null,
        readOnly: device.readOnly,
        readOnlyReason: device.readOnly ? "The server exports the disk read-only." : undefined,
      };

      try {
        const root = await verifyApaRoot(device);
        if (!root.ok) {
          s.readOnly = true;
          s.readOnlyReason = root.reason;
          log.warn(`APA verification failed: ${root.reason}`);
        } else {
          if (root.toxicTwoSlice) {
            s.readOnly = true;
            s.readOnlyReason = root.reason;
          }
          s.map = await readPartitionMap(device);
          if (s.map.problems.length > 0 && !s.readOnly) {
            s.readOnly = true;
            s.readOnlyReason =
              "The partition table has problems — connected read-only.";
            for (const p of s.map.problems) {
              log.warn(`APA problem @${p.sector}: ${p.message}`);
            }
          }
        }
      } catch (err) {
        await device.close().catch(() => undefined);
        throw err;
      }

      session = s;
      const info = sessionInfo(s);
      log.info(
        `Connected: ${formatBytes(info.sizeBytes)} total, ` +
          `${formatBytes(info.freeBytes)} free${info.readOnly ? " (read-only)" : ""}`
      );
      return { success: true, info };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Connect failed: ${message}`);
    return { success: false, message };
  }
}

async function closeSession(): Promise<void> {
  if (!session) return;
  const s = session;
  session = null;
  log.info(`Disconnecting from ${s.label}`);
  await s.device.close().catch((err) => {
    log.verbose(`Error while closing device: ${err instanceof Error ? err.message : err}`);
  });
}

export async function hddDisconnect(): Promise<{ success: boolean; message?: string }> {
  try {
    return await withLock("disconnect", async () => {
      await closeSession();
      return { success: true };
    });
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function hddStatus(): HddStatus {
  return session
    ? {
        connected: true,
        target: session.target,
        info: sessionInfo(session),
        busy: busyOperation,
      }
    : { connected: false, busy: busyOperation };
}

export async function hddListGames(): Promise<{
  success: boolean;
  games?: HdlGame[];
  skipped?: { partitionId: string; reason: string }[];
  info?: HddInfo;
  message?: string;
}> {
  try {
    return await withLock("list-games", async () => {
      if (!session) throw new Error("Not connected to a PS2 HDD.");
      if (!session.map) {
        return {
          success: true,
          games: [],
          skipped: [],
          info: sessionInfo(session),
        };
      }
      // Re-read the chain so external changes (e.g. games installed from the
      // PS2 side between refreshes) are picked up.
      session.map = await readPartitionMap(session.device);
      const { games, skipped } = await listHdlGames(session.device, session.map);
      for (const s of skipped) {
        log.warn(`Skipped unreadable HDL partition "${s.partitionId}": ${s.reason}`);
      }
      log.verbose(`Listed ${games.length} installed game(s)`);
      return { success: true, games, skipped, info: sessionInfo(session) };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Listing games failed: ${message}`);
    return { success: false, message };
  }
}

/** Used on app quit so a lingering socket doesn't hold the PS2's NBD slot. */
export async function hddShutdown(): Promise<void> {
  await closeSession();
}

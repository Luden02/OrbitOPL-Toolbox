/**
 * HDL game-info block: 1 KiB of metadata HD Loader (and OPL) reads from
 * byte offset 0x101000 within a game's main partition. Layout verified
 * against hdl-dump's hdl.c:
 *
 *   +0x000 u32  magic 0xdeadfeed
 *   +0x006 u8   0x01 (always)
 *   +0x008 c[]  game title, asciiz (field runs to +0xA8)
 *   +0x0A9 u8   compatibility flags (OPL MODE1..MODE8 bits)
 *   +0x0AA u16  DMA mode (0x20|n = MDMA n, 0x40|n = UDMA n)
 *   +0x0AC c[]  startup id, e.g. "SLUS_123.45", asciiz
 *   +0x0E8 u32  DVD9 layer-break LBA (0 for single layer/CD)
 *   +0x0EC u32  media type: 0x14 DVD, 0x12 CD, 0x10 PSX CD
 *   +0x0F0 u8   number of data areas (main + subs)
 *   +0x0F5 {u32 offset, u32 startSector>>8, u32 sizeKiB*4}[count]
 *          offset = cumulative data offset in 1024-sector (512 KiB) units;
 *          ISO data lives at +0x2000 sectors in the main partition and
 *          +0x800 sectors in each sub-partition.
 */

import { BlockDevice, SECTOR_SIZE } from "../block-device";
import { APA_FLAG_SUB, APA_TYPE_HDL, ApaHeader, PartitionMap } from "./apa-types";

export const HDL_INFO_OFFSET_BYTES = 0x101000;
export const HDL_INFO_BYTES = 1024;
export const HDL_MAGIC = 0xdeadfeed;

/** Sector offsets of the ISO data region within main/sub partitions. */
export const HDL_MAIN_DATA_OFFSET_SECTORS = 0x2000; // 4 MiB
export const HDL_SUB_DATA_OFFSET_SECTORS = 0x800; // 1 MiB

export const HDL_MEDIA_DVD = 0x14;
export const HDL_MEDIA_CD = 0x12;
export const HDL_MEDIA_PSX_CD = 0x10;

const TITLE_OFFSET = 0x008;
const TITLE_MAX = 0xa8 - 0x008; // 160 bytes
const COMPAT_OFFSET = 0x0a9;
const DMA_OFFSET = 0x0aa;
const STARTUP_OFFSET = 0x0ac;
const STARTUP_MAX = 13; // "SLUS_123.45" + NUL
const LAYER_BREAK_OFFSET = 0x0e8;
const MEDIA_OFFSET = 0x0ec;
const NUM_PARTS_OFFSET = 0x0f0;
const PART_TABLE_OFFSET = 0x0f5; // unaligned on purpose — matches HD Loader
const PART_TABLE_MAX = 65;

export interface HdlPartEntry {
  /** Cumulative data offset in 1024-sector (512 KiB) units. */
  offset: number;
  /** Data start sector, stored shifted right by 8. */
  startShr8: number;
  /** Data length in KiB multiplied by 4. */
  sizeKb4: number;
}

export interface HdlInfo {
  title: string;
  compatFlags: number;
  dmaMode: number;
  startupId: string;
  layerBreak: number;
  mediaType: number;
  parts: HdlPartEntry[];
  /** Original block for read-modify-write edits. */
  raw: Buffer;
}

/** One installed game, as surfaced to the UI. */
export interface HdlGame {
  title: string;
  startupId: string;
  /** Raw ISO size in bytes (sum of the data areas). */
  sizeBytes: number;
  /** Total allocated partition space in bytes (main + subs). */
  allocBytes: number;
  compatFlags: number;
  dmaMode: number;
  mediaType: number;
  /** Main partition start sector — the stable handle for mutations. */
  mainStart: number;
  /** APA partition id, e.g. "PP.SLUS-12345..GAME_NAME". */
  partitionId: string;
  /** True when the partition id starts with "__" (hidden from HDD-OSD). */
  hidden: boolean;
}

function readCString(buf: Buffer, offset: number, max: number): string {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + max ? offset + max : end;
  return buf.toString("latin1", offset, stop);
}

export function parseHdlInfo(block: Buffer): HdlInfo {
  if (block.length !== HDL_INFO_BYTES) {
    throw new Error(`HDL info block must be ${HDL_INFO_BYTES} bytes`);
  }
  if (block.readUInt32LE(0) !== HDL_MAGIC) {
    throw new Error("HDL info block has no 0xdeadfeed magic");
  }
  const count = Math.min(block.readUInt8(NUM_PARTS_OFFSET), PART_TABLE_MAX);
  const parts: HdlPartEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = PART_TABLE_OFFSET + i * 12;
    parts.push({
      offset: block.readUInt32LE(at),
      startShr8: block.readUInt32LE(at + 4),
      sizeKb4: block.readUInt32LE(at + 8),
    });
  }
  return {
    title: readCString(block, TITLE_OFFSET, TITLE_MAX),
    compatFlags: block.readUInt8(COMPAT_OFFSET),
    dmaMode: block.readUInt16LE(DMA_OFFSET),
    startupId: readCString(block, STARTUP_OFFSET, STARTUP_MAX),
    layerBreak: block.readUInt32LE(LAYER_BREAK_OFFSET),
    mediaType: block.readUInt32LE(MEDIA_OFFSET),
    parts,
    raw: Buffer.from(block),
  };
}

export interface HdlInfoInit {
  title: string;
  startupId: string;
  compatFlags: number;
  dmaMode: number;
  layerBreak: number;
  isDvd: boolean;
}

/**
 * Builds a fresh HDL info block for a main partition header whose subs are
 * already laid out. Data lengths are distributed across main + subs exactly
 * like hdl-dump: fill each area to capacity in order until sizeKb is spent.
 */
export function buildHdlInfo(init: HdlInfoInit, main: ApaHeader, sizeKb: number): Buffer {
  const block = Buffer.alloc(HDL_INFO_BYTES);
  block.writeUInt32LE(HDL_MAGIC, 0);
  block.writeUInt8(0x01, 0x06);
  block.write(init.title.slice(0, TITLE_MAX - 1), TITLE_OFFSET, "latin1");
  block.writeUInt8(init.compatFlags & 0xff, COMPAT_OFFSET);
  block.writeUInt16LE(init.dmaMode & 0xffff, DMA_OFFSET);
  block.write(init.startupId.slice(0, STARTUP_MAX - 1), STARTUP_OFFSET, "latin1");
  block.writeUInt32LE(init.layerBreak >>> 0, LAYER_BREAK_OFFSET);
  block.writeUInt32LE(init.isDvd ? HDL_MEDIA_DVD : HDL_MEDIA_CD, MEDIA_OFFSET);

  const areas = dataAreas(main);
  let kbRemaining = sizeKb;
  let cursor = PART_TABLE_OFFSET;
  let used = 0;
  let offset = 0;
  for (const area of areas) {
    if (kbRemaining <= 0) break;
    const capacityKb = area.capacitySectors / 2;
    const lenKb = Math.min(kbRemaining, capacityKb);
    block.writeUInt32LE(offset, cursor);
    block.writeUInt32LE(area.dataStartSector >> 8, cursor + 4);
    block.writeUInt32LE(lenKb * 4, cursor + 8);
    cursor += 12;
    used++;
    offset += area.capacitySectors / 1024;
    kbRemaining -= lenKb;
  }
  if (kbRemaining > 0) {
    throw new Error("Game data does not fit in the allocated partitions");
  }
  block.writeUInt8(used, NUM_PARTS_OFFSET);
  return block;
}

export interface HdlDataArea {
  /** Absolute sector where ISO data starts in this area. */
  dataStartSector: number;
  /** Usable data sectors in this area (header region excluded). */
  capacitySectors: number;
}

/** Data areas of a game in write order: main first, then subs in order. */
export function dataAreas(main: ApaHeader): HdlDataArea[] {
  const areas: HdlDataArea[] = [
    {
      dataStartSector: main.start + HDL_MAIN_DATA_OFFSET_SECTORS,
      capacitySectors: main.length - HDL_MAIN_DATA_OFFSET_SECTORS,
    },
  ];
  for (const sub of main.subs) {
    areas.push({
      dataStartSector: sub.start + HDL_SUB_DATA_OFFSET_SECTORS,
      capacitySectors: sub.length - HDL_SUB_DATA_OFFSET_SECTORS,
    });
  }
  return areas;
}

export async function readHdlInfo(dev: BlockDevice, mainStart: number): Promise<HdlInfo> {
  const block = await dev.read(mainStart * SECTOR_SIZE + HDL_INFO_OFFSET_BYTES, HDL_INFO_BYTES);
  return parseHdlInfo(block);
}

export async function writeHdlInfo(
  dev: BlockDevice,
  mainStart: number,
  block: Buffer
): Promise<void> {
  if (block.length !== HDL_INFO_BYTES) {
    throw new Error(`HDL info block must be ${HDL_INFO_BYTES} bytes`);
  }
  await dev.write(mainStart * SECTOR_SIZE + HDL_INFO_OFFSET_BYTES, block);
}

/** Main partitions holding HDL games: type 0x1337, not flagged as sub. */
export function hdlMainPartitions(map: PartitionMap): ApaHeader[] {
  return map.partitions.filter(
    (p) => p.type === APA_TYPE_HDL && (p.flags & APA_FLAG_SUB) === 0 && p.main === 0
  );
}

/**
 * Lists installed games. Partitions whose info block is unreadable are
 * skipped and reported in `skipped` instead of failing the whole listing.
 */
export async function listHdlGames(
  dev: BlockDevice,
  map: PartitionMap
): Promise<{ games: HdlGame[]; skipped: { partitionId: string; reason: string }[] }> {
  const games: HdlGame[] = [];
  const skipped: { partitionId: string; reason: string }[] = [];
  for (const main of hdlMainPartitions(map)) {
    try {
      const info = await readHdlInfo(dev, main.start);
      const sizeKb = info.parts.reduce((sum, p) => sum + p.sizeKb4, 0) / 4;
      const allocSectors =
        main.length + main.subs.reduce((sum, s) => sum + s.length, 0);
      games.push({
        title: info.title,
        startupId: info.startupId,
        sizeBytes: sizeKb * 1024,
        allocBytes: allocSectors * SECTOR_SIZE,
        compatFlags: info.compatFlags,
        dmaMode: info.dmaMode,
        mediaType: info.mediaType,
        mainStart: main.start,
        partitionId: main.id,
        hidden: main.id.startsWith("__"),
      });
    } catch (err) {
      skipped.push({
        partitionId: main.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { games, skipped };
}

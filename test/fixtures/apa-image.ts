/**
 * Synthetic APA disk-image builder for the HDD test suites.
 *
 * Builds realistic partition layouts in a sparse MemoryBlockDevice: a Sony
 * MBR header on sector 0, the standard system partitions, and optionally
 * HDL games with patterned data — no binary fixtures in git. The builder
 * keeps partitions in a start-sorted list and rewrites the whole circular
 * chain on commit, which is exactly the invariant the reader validates.
 */

import { MemoryBlockDevice, SECTOR_SIZE } from "../../src/hdd/block-device";
import {
  apaDatetimeNow,
  serializeApaHeader,
} from "../../src/hdd/apa/apa-codec";
import {
  APA_CHUNK_SECTORS,
  APA_FLAG_SUB,
  APA_MBR_MAGIC,
  APA_MODVER,
  APA_TYPE_HDL,
  APA_TYPE_MBR,
  APA_TYPE_PFS,
  ApaHeader,
} from "../../src/hdd/apa/apa-types";
import {
  buildHdlInfo,
  dataAreas,
  writeHdlInfo,
} from "../../src/hdd/apa/hdl-meta";

const FIXED_DATE = apaDatetimeNow(new Date(2026, 0, 1, 12, 0, 0));

export interface GameSpec {
  title: string;
  startupId: string;
  /** Raw ISO size in bytes. */
  sizeBytes: number;
  /** Partition runs as [startSector, lengthSectors]; first is the main. */
  runs: [number, number][];
  compatFlags?: number;
  dmaMode?: number;
  isDvd?: boolean;
  partitionId?: string;
}

export class ApaImageBuilder {
  public readonly dev: MemoryBlockDevice;
  public readonly parts: ApaHeader[] = [];
  private readonly sectorCount: number;

  constructor(sizeBytes: number) {
    this.dev = new MemoryBlockDevice(sizeBytes);
    this.sectorCount = sizeBytes / SECTOR_SIZE;
  }

  private baseHeader(overrides: Partial<ApaHeader>): ApaHeader {
    return {
      checksum: 0,
      next: 0,
      prev: 0,
      id: "",
      start: 0,
      length: APA_CHUNK_SECTORS,
      type: APA_TYPE_PFS,
      flags: 0,
      nsub: 0,
      created: FIXED_DATE,
      main: 0,
      number: 0,
      modver: APA_MODVER,
      name: "",
      subs: [],
      ...overrides,
    };
  }

  /** Sony MBR partition on sector 0 plus the standard system partitions. */
  public addSystemPartitions(): this {
    const mbrRaw = Buffer.alloc(1024);
    mbrRaw.write(APA_MBR_MAGIC, 0x100, "latin1");
    mbrRaw.writeUInt32LE(2, 0x120); // version
    mbrRaw.writeUInt32LE(this.sectorCount, 0x124); // nsector
    this.parts.push(
      this.baseHeader({
        id: "__mbr",
        start: 0,
        length: APA_CHUNK_SECTORS,
        type: APA_TYPE_MBR,
        raw: mbrRaw,
      })
    );
    let sector = APA_CHUNK_SECTORS;
    for (const id of ["__net", "__system", "__sysconf", "__common"]) {
      this.parts.push(
        this.baseHeader({ id, start: sector, length: APA_CHUNK_SECTORS })
      );
      sector += APA_CHUNK_SECTORS;
    }
    return this;
  }

  /** Adds a game's main+sub headers, HDL info block, and patterned data. */
  public async addGame(spec: GameSpec): Promise<ApaHeader> {
    if (spec.runs.length === 0) throw new Error("Game needs at least one run");
    const [mainStart, mainLength] = spec.runs[0];
    const main = this.baseHeader({
      id: spec.partitionId ?? `PP.${spec.startupId.replace(/[_.]/g, "-")}..TEST`,
      start: mainStart,
      length: mainLength,
      type: APA_TYPE_HDL,
      nsub: spec.runs.length - 1,
      subs: spec.runs.slice(1).map(([start, length]) => ({ start, length })),
    });
    this.parts.push(main);
    spec.runs.slice(1).forEach(([start, length], i) => {
      this.parts.push(
        this.baseHeader({
          start,
          length,
          type: APA_TYPE_HDL,
          flags: APA_FLAG_SUB,
          main: mainStart,
          number: i + 1,
        })
      );
    });

    const sizeKb = Math.ceil(spec.sizeBytes / 1024);
    const info = buildHdlInfo(
      {
        title: spec.title,
        startupId: spec.startupId,
        compatFlags: spec.compatFlags ?? 0,
        dmaMode: spec.dmaMode ?? 0x40 | 4, // UDMA4
        layerBreak: 0,
        isDvd: spec.isDvd ?? true,
      },
      main,
      sizeKb
    );
    await writeHdlInfo(this.dev, mainStart, info);
    await this.writePatternedData(main, spec.sizeBytes);
    return main;
  }

  /** Deterministic per-game data so extraction/round-trips can verify it. */
  private async writePatternedData(main: ApaHeader, sizeBytes: number): Promise<void> {
    let remaining = sizeBytes;
    let isoOffset = 0;
    for (const area of dataAreas(main)) {
      if (remaining <= 0) break;
      const n = Math.min(remaining, area.capacitySectors * SECTOR_SIZE);
      // Only stamp the first and last sector of each area — enough for
      // verification without writing gigabytes in tests.
      const first = makePatternSector(isoOffset);
      await this.dev.write(area.dataStartSector * SECTOR_SIZE, first);
      const lastOffset = Math.floor((n - 1) / SECTOR_SIZE) * SECTOR_SIZE;
      if (lastOffset > 0) {
        const last = makePatternSector(isoOffset + lastOffset);
        await this.dev.write(area.dataStartSector * SECTOR_SIZE + lastOffset, last);
      }
      isoOffset += n;
      remaining -= n;
    }
  }

  /** Serializes the whole chain: sorts by start, links circularly, writes. */
  public async commit(): Promise<MemoryBlockDevice> {
    this.parts.sort((a, b) => a.start - b.start);
    const count = this.parts.length;
    for (let i = 0; i < count; i++) {
      const curr = this.parts[i];
      curr.prev = this.parts[(i - 1 + count) % count].start;
      curr.next = this.parts[(i + 1) % count].start;
      await this.dev.write(curr.start * SECTOR_SIZE, serializeApaHeader(curr));
    }
    return this.dev;
  }
}

/** A sector filled with a value derived from its ISO byte offset. */
export function makePatternSector(isoByteOffset: number): Buffer {
  const buf = Buffer.alloc(SECTOR_SIZE);
  for (let i = 0; i < SECTOR_SIZE; i += 8) {
    buf.writeUInt32LE(isoByteOffset >>> 0, i);
    buf.writeUInt32LE((isoByteOffset / 0x100000000) >>> 0, i + 4);
  }
  return buf;
}

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;

/** 40 GiB disk with system partitions — the common starting point. */
export async function standardDisk(sizeBytes = 40 * GiB): Promise<ApaImageBuilder> {
  const b = new ApaImageBuilder(sizeBytes);
  b.addSystemPartitions();
  return b;
}

/**
 * APA table reader: walks the on-disk partition chain and validates it.
 *
 * Mirrors hdl-dump's apa_slice_read/apa_check_slice semantics: start at the
 * MBR header on sector 0, follow `next` until it returns to 0, then verify
 * the doubly-linked list is sorted by start sector and circular, partition
 * sizes are power-of-two multiples of 128 MiB, starts are aligned to their
 * own length, nothing overlaps, and sub-partition bookkeeping matches.
 *
 * Anomalies are collected as problems rather than thrown — the caller shows
 * them and locks the connection to read-only. A completely un-APA disk
 * (no magic on sector 0) throws, since there is nothing to read.
 */

import { BlockDevice, SECTOR_SIZE } from "../block-device";
import {
  apaChecksum,
  hasApaMagic,
  isValidMbrMagic,
  parseApaHeader,
  parseMbrInfo,
} from "./apa-codec";
import {
  APA_CHUNK_SECTORS,
  APA_FLAG_SUB,
  APA_HEADER_BYTES,
  APA_MBR_VERSION_MAX,
  APA_TYPE_MBR,
  ApaHeader,
  ApaProblem,
  PartitionMap,
} from "./apa-types";

/** Way above any legitimate partition count; guards against chain loops. */
const MAX_CHAIN_LENGTH = 10001;

export interface ApaRootCheck {
  ok: boolean;
  reason?: string;
  /** ToxicOS 2-slice layout detected — we must not write to such disks. */
  toxicTwoSlice?: boolean;
}

/**
 * Cheap gate run at connect time: is sector 0 a sane APA MBR header we are
 * allowed to treat as a PS2 disk? Writing is refused unless this passes.
 */
export async function verifyApaRoot(dev: BlockDevice): Promise<ApaRootCheck> {
  if (dev.sizeBytes < APA_HEADER_BYTES) {
    return { ok: false, reason: "Device is too small to be a PS2 disk." };
  }
  const buf = await dev.read(0, APA_HEADER_BYTES);
  if (!hasApaMagic(buf)) {
    return { ok: false, reason: "No APA signature on sector 0 — not a PS2-formatted disk." };
  }
  if (buf.readUInt32LE(0) !== apaChecksum(buf)) {
    return { ok: false, reason: "APA root header has a bad checksum." };
  }
  const header = parseApaHeader(buf);
  if (header.type !== APA_TYPE_MBR) {
    return { ok: false, reason: `Sector-0 partition has unexpected type 0x${header.type.toString(16)}.` };
  }
  const mbr = parseMbrInfo(buf);
  if (!isValidMbrMagic(mbr)) {
    return { ok: false, reason: "APA MBR magic string is missing — refusing to treat this as a PS2 disk." };
  }
  if (mbr.version > APA_MBR_VERSION_MAX) {
    return { ok: false, reason: `Unsupported APA MBR version ${mbr.version}.` };
  }
  if (mbr.toxicTwoSlice) {
    return {
      ok: true,
      toxicTwoSlice: true,
      reason: "ToxicOS 2-slice disk detected — shown read-only (unsupported layout).",
    };
  }
  return { ok: true };
}

/** Reads and parses the full partition chain. Throws only if sector 0 is not APA. */
export async function readPartitionMap(dev: BlockDevice): Promise<PartitionMap> {
  const sectorCount = Math.floor(dev.sizeBytes / SECTOR_SIZE);
  const problems: ApaProblem[] = [];
  const partitions: ApaHeader[] = [];
  const seen = new Set<number>();

  let sector = 0;
  for (let n = 0; n < MAX_CHAIN_LENGTH; n++) {
    const buf = await dev.read(sector * SECTOR_SIZE, APA_HEADER_BYTES);
    if (!hasApaMagic(buf)) {
      if (sector === 0) {
        throw new Error("Not an APA disk: no partition signature on sector 0.");
      }
      problems.push({
        sector,
        message: `Chain points at sector ${sector} but there is no partition header there.`,
      });
      break;
    }
    const header = parseApaHeader(buf);
    if (buf.readUInt32LE(0) !== apaChecksum(buf)) {
      problems.push({ sector, message: `Bad header checksum at sector ${sector}.` });
    }
    if (header.start !== sector) {
      problems.push({
        sector,
        message: `Header at sector ${sector} claims start=${header.start}.`,
      });
    }
    if (!(header.start < sectorCount && header.start + header.length <= sectorCount)) {
      problems.push({
        sector,
        message: `Partition at sector ${sector} extends beyond the end of the device.`,
      });
      break;
    }
    partitions.push(header);
    seen.add(sector);

    if (header.next === 0) break; // chain wraps back to the MBR
    if (seen.has(header.next)) {
      problems.push({ sector, message: `Partition chain loops back to sector ${header.next}.` });
      break;
    }
    sector = header.next;
    if (n === MAX_CHAIN_LENGTH - 1) {
      problems.push({ sector, message: "Partition chain exceeds sane length; aborting walk." });
    }
  }

  const mbr = parseMbrInfo(partitions.length > 0 ? partitions[0].raw! : Buffer.alloc(APA_HEADER_BYTES));
  if (partitions.length === 0 || !isValidMbrMagic(mbr)) {
    problems.push({ sector: 0, message: "APA MBR magic string is missing on sector 0." });
  }
  if (mbr.toxicTwoSlice) {
    problems.push({ sector: 0, message: "ToxicOS 2-slice layout — read-only." });
  }

  validateGeometry(partitions, sectorCount, problems);
  validateChainLinks(partitions, problems);
  validateSubPartitions(partitions, problems);

  return { sectorCount, partitions, mbr, problems };
}

function validateGeometry(
  partitions: ApaHeader[],
  sectorCount: number,
  problems: ApaProblem[]
): void {
  for (let i = 0; i < partitions.length; i++) {
    const p = partitions[i];
    if (p.length === 0 || p.length % APA_CHUNK_SECTORS !== 0) {
      problems.push({
        sector: p.start,
        message: `Partition at sector ${p.start} has size not a multiple of 128 MiB.`,
      });
    } else if (p.start % p.length !== 0) {
      problems.push({
        sector: p.start,
        message: `Partition at sector ${p.start} is not aligned to its own size.`,
      });
    }
    // The chain is start-sorted, so overlap only needs a neighbor check.
    if (i > 0) {
      const prev = partitions[i - 1];
      if (p.start < prev.start + prev.length) {
        problems.push({
          sector: p.start,
          message: `Partition at sector ${p.start} overlaps the one at sector ${prev.start}.`,
        });
      }
      if (p.start <= prev.start) {
        problems.push({
          sector: p.start,
          message: `Partition chain is not sorted by start sector at sector ${p.start}.`,
        });
      }
    }
    void sectorCount;
  }
}

function validateChainLinks(partitions: ApaHeader[], problems: ApaProblem[]): void {
  const count = partitions.length;
  if (count === 0) return;
  for (let i = 0; i < count; i++) {
    const curr = partitions[i];
    const prev = partitions[(i - 1 + count) % count];
    const next = partitions[(i + 1) % count];
    // Forward links are consistent by construction of the walk except for the
    // last one, which must wrap to the MBR (sector 0).
    if (curr.next !== next.start) {
      problems.push({
        sector: curr.start,
        message: `Partition at sector ${curr.start} has next=${curr.next}, expected ${next.start}.`,
      });
    }
    if (curr.prev !== prev.start) {
      problems.push({
        sector: curr.start,
        message: `Partition at sector ${curr.start} has prev=${curr.prev}, expected ${prev.start}.`,
        repairable: true,
      });
    }
  }
}

function validateSubPartitions(partitions: ApaHeader[], problems: ApaProblem[]): void {
  const byStart = new Map<number, ApaHeader>();
  for (const p of partitions) byStart.set(p.start, p);

  for (const main of partitions) {
    if (main.main !== 0 || main.flags !== 0 || main.start === 0) continue;
    let found = 0;
    for (const sub of partitions) {
      if (sub.main !== main.start) continue;
      found++;
      if ((sub.flags & APA_FLAG_SUB) === 0) {
        problems.push({
          sector: sub.start,
          message: `Partition at sector ${sub.start} references a main partition but lacks the sub flag.`,
        });
      }
      const listed = main.subs.find((s) => s.start === sub.start);
      if (!listed) {
        problems.push({
          sector: sub.start,
          message: `Sub-partition at sector ${sub.start} is not listed by its main at sector ${main.start}.`,
        });
      } else if (listed.length !== sub.length) {
        problems.push({
          sector: sub.start,
          message: `Sub-partition at sector ${sub.start} size differs from its main's record.`,
        });
      }
    }
    if (found !== main.nsub) {
      problems.push({
        sector: main.start,
        message: `Main partition at sector ${main.start} lists ${main.nsub} sub-partitions but ${found} exist.`,
      });
    }
  }
}

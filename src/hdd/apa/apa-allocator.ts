/**
 * APA free-space model. Mirrors hdl-dump's chunk accounting: the disk is
 * divided into 128 MiB chunks; a chunk is allocated when any partition in
 * the chain covers it and free otherwise (free space is implicit — the
 * gaps between partitions). Existing type-0 "__empty" partitions left by
 * other tools still sit in the chain, so their chunks count as allocated;
 * that is the conservative reading hdl-dump uses too.
 *
 * planAllocation (the install-time allocator) lands with the install
 * pipeline milestone and builds on this model.
 */

import { APA_CHUNK_SECTORS, PartitionMap } from "./apa-types";

export interface ChunkMap {
  /** Total 128 MiB chunks on the device (floor of capacity). */
  totalChunks: number;
  /** chunk index -> allocated? */
  allocated: boolean[];
  freeChunks: number;
}

export function buildChunkMap(map: PartitionMap): ChunkMap {
  const totalChunks = Math.floor(map.sectorCount / APA_CHUNK_SECTORS);
  const allocated = new Array<boolean>(totalChunks).fill(false);
  for (const part of map.partitions) {
    const first = Math.floor(part.start / APA_CHUNK_SECTORS);
    const count = Math.ceil(part.length / APA_CHUNK_SECTORS);
    for (let i = first; i < first + count && i < totalChunks; i++) {
      allocated[i] = true;
    }
  }
  const freeChunks = allocated.reduce((n, a) => n + (a ? 0 : 1), 0);
  return { totalChunks, allocated, freeChunks };
}

export function freeBytes(map: PartitionMap): number {
  return buildChunkMap(map).freeChunks * APA_CHUNK_SECTORS * 512;
}

/**
 * Largest single partition hdl-dump would create on this disk:
 * (totalChunks / 32) chunks, minimum one — the same heuristic the PS2's
 * own APA driver uses for its maximum partition size.
 */
export function maxPartitionBytes(totalChunks: number): number {
  const chunks = totalChunks < 32 ? 1 : Math.floor(totalChunks / 32);
  return chunks * APA_CHUNK_SECTORS * 512;
}

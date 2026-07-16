/**
 * PS2 APA (Aligned Partition Allocation) on-disk structures.
 *
 * Field layout verified against hdl-dump's ps2_hdd.h / apa.c (used as a
 * format reference). Every partition starts with a 1 KiB header; headers
 * form a doubly-linked list ordered by start sector, circular through the
 * MBR partition at sector 0. Free space is implicit — the gaps between
 * partitions — and is managed in 128 MiB chunks: partition lengths are
 * always a power-of-two multiple of 128 MiB and every partition starts on
 * a multiple of its own length.
 *
 * All multi-byte integers are little-endian. Sector = 512 bytes.
 */

export const APA_MAGIC = 0x00415041; // "APA\0"
export const APA_HEADER_BYTES = 1024;
export const APA_MBR_MAGIC = "Sony Computer Entertainment Inc."; // 32 bytes exactly
export const APA_MBR_VERSION_MAX = 2;
export const APA_IDMAX = 32;
export const APA_NAMEMAX = 128;
export const APA_MAXSUB = 64;
export const APA_FLAG_SUB = 0x0001;
export const APA_MODVER = 0x201;

/** Partition types. */
export const APA_TYPE_FREE = 0x0000;
export const APA_TYPE_MBR = 0x0001;
export const APA_TYPE_SWAP = 0x0082;
export const APA_TYPE_LINUX = 0x0083;
export const APA_TYPE_PFS = 0x0100;
export const APA_TYPE_HDL = 0x1337;

/** Allocation granularity: 128 MiB = 262144 sectors. */
export const APA_CHUNK_BYTES = 128 * 1024 * 1024;
export const APA_CHUNK_SECTORS = APA_CHUNK_BYTES / 512;

/** ToxicOS "APAEXT" extension magic (2-slice >128 GiB disks) — unsupported. */
export const APA_TOXIC_MAGIC = "APAEXT\0\0";

/** v1 supports single-slice standard APA: u32 sector addresses, <= 2 TiB. */
export const APA_MAX_DEVICE_BYTES = 2 * 1024 * 1024 * 1024 * 1024;

export interface ApaDatetime {
  sec: number;
  min: number;
  hour: number;
  day: number;
  month: number;
  year: number;
}

export interface ApaSub {
  /** Sector address of the sub-partition. */
  start: number;
  /** Sector count. */
  length: number;
}

/**
 * Parsed 1 KiB partition header. `raw` keeps the original bytes so
 * read-modify-write edits preserve fields we don't model (icons, DMS/Toxic
 * boot data, MBR payload).
 */
export interface ApaHeader {
  checksum: number;
  /** Sector address of the next partition in the chain (0 = back to MBR). */
  next: number;
  /** Sector address of the previous partition in the chain. */
  prev: number;
  /** Partition identifier, e.g. "PP.SLUS-12345..GAME_NAME" (max 32 chars). */
  id: string;
  /** Sector address of this partition (matches its location on disk). */
  start: number;
  /** Sector count; power-of-two multiple of 128 MiB worth of sectors. */
  length: number;
  type: number;
  flags: number;
  /** Number of sub-partitions (main partitions only). */
  nsub: number;
  created: ApaDatetime;
  /** For sub-partitions: sector address of their main partition, else 0. */
  main: number;
  /** For sub-partitions: 1-based sub index, else 0. */
  number: number;
  modver: number;
  /** 128-byte name field (unused by hdl-dump for games; id carries the name). */
  name: string;
  subs: ApaSub[];
  /** Original 1024 header bytes as read from disk (absent for new headers). */
  raw?: Buffer;
}

/** MBR block carried inside the sector-0 partition header. */
export interface ApaMbrInfo {
  magic: string;
  version: number;
  nsector: number;
  isToxic: boolean;
  toxicTwoSlice: boolean;
}

export interface ApaProblem {
  /** Sector of the offending header (as encountered). */
  sector: number;
  message: string;
  /**
   * The one anomaly we know how to repair safely: a header whose `prev`
   * does not match its in-chain predecessor (interrupted commit).
   */
  repairable?: boolean;
}

export interface PartitionMap {
  /** Total device capacity in sectors. */
  sectorCount: number;
  /** All partitions in chain (= start sector) order, beginning with the MBR. */
  partitions: ApaHeader[];
  mbr: ApaMbrInfo;
  /** Non-fatal anomalies. Non-empty => mutations must be refused. */
  problems: ApaProblem[];
}

/**
 * APA partition-header codec: parse/serialize the 1 KiB on-disk header and
 * compute its checksum. Byte offsets follow hdl-dump's ps2_hdd.h exactly:
 *
 *   0x000 u32  checksum        sum of u32 words 1..255
 *   0x004 u8[4] magic          "APA\0"
 *   0x008 u32  next            sector of next partition (0 = wraps to MBR)
 *   0x00C u32  prev            sector of previous partition
 *   0x010 c[32] id
 *   0x030 c[16] (passwords, unused)
 *   0x040 u32  start           sector address of this partition
 *   0x044 u32  length          sector count
 *   0x048 u16  type
 *   0x04A u16  flags
 *   0x04C u32  nsub
 *   0x050 8B   created         {unused,sec,min,hour,day,month,u16 year}
 *   0x058 u32  main
 *   0x05C u32  number
 *   0x060 u32  modver
 *   0x064 28B  padding
 *   0x080 c[128] name
 *   0x100 256B mbr             magic[32], u32 version, u32 nsector, created,
 *                              data_start, data_len, ..., toxic magic/flags
 *   0x200 {u32 start,u32 length}[64] subs
 */

import {
  APA_HEADER_BYTES,
  APA_IDMAX,
  APA_MAGIC,
  APA_MAXSUB,
  APA_MBR_MAGIC,
  APA_NAMEMAX,
  APA_TOXIC_MAGIC,
  ApaDatetime,
  ApaHeader,
  ApaMbrInfo,
} from "./apa-types";

/** Sum of u32 LE words 1..255 (word 0 is the checksum itself), mod 2^32. */
export function apaChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 4; i < APA_HEADER_BYTES; i += 4) {
    sum = (sum + header.readUInt32LE(i)) >>> 0;
  }
  return sum;
}

function readCString(buf: Buffer, offset: number, max: number): string {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + max ? offset + max : end;
  return buf.toString("latin1", offset, stop);
}

function parseDatetime(buf: Buffer, offset: number): ApaDatetime {
  return {
    sec: buf.readUInt8(offset + 1),
    min: buf.readUInt8(offset + 2),
    hour: buf.readUInt8(offset + 3),
    day: buf.readUInt8(offset + 4),
    month: buf.readUInt8(offset + 5),
    year: buf.readUInt16LE(offset + 6),
  };
}

function writeDatetime(buf: Buffer, offset: number, dt: ApaDatetime): void {
  buf.writeUInt8(0, offset);
  buf.writeUInt8(dt.sec, offset + 1);
  buf.writeUInt8(dt.min, offset + 2);
  buf.writeUInt8(dt.hour, offset + 3);
  buf.writeUInt8(dt.day, offset + 4);
  buf.writeUInt8(dt.month, offset + 5);
  buf.writeUInt16LE(dt.year, offset + 6);
}

export function hasApaMagic(header: Buffer): boolean {
  return header.length >= 8 && header.readUInt32LE(4) === APA_MAGIC;
}

/** Parses a 1 KiB header buffer. Does NOT validate checksum/magic — callers
 *  decide how to treat anomalies (the reader reports them as problems). */
export function parseApaHeader(header: Buffer): ApaHeader {
  if (header.length !== APA_HEADER_BYTES) {
    throw new Error(`APA header must be ${APA_HEADER_BYTES} bytes`);
  }
  const nsub = header.readUInt32LE(0x4c);
  const subs = [];
  for (let i = 0; i < Math.min(nsub, APA_MAXSUB); i++) {
    subs.push({
      start: header.readUInt32LE(0x200 + i * 8),
      length: header.readUInt32LE(0x204 + i * 8),
    });
  }
  return {
    checksum: header.readUInt32LE(0x00),
    next: header.readUInt32LE(0x08),
    prev: header.readUInt32LE(0x0c),
    id: readCString(header, 0x10, APA_IDMAX),
    start: header.readUInt32LE(0x40),
    length: header.readUInt32LE(0x44),
    type: header.readUInt16LE(0x48),
    flags: header.readUInt16LE(0x4a),
    nsub,
    created: parseDatetime(header, 0x50),
    main: header.readUInt32LE(0x58),
    number: header.readUInt32LE(0x5c),
    modver: header.readUInt32LE(0x60),
    name: readCString(header, 0x80, APA_NAMEMAX),
    subs,
    raw: Buffer.from(header),
  };
}

/** MBR block (only meaningful on the sector-0 header). */
export function parseMbrInfo(header: Buffer): ApaMbrInfo {
  const magic = header.toString("latin1", 0x100, 0x120);
  const toxicMagic = header.toString("latin1", 0x1f4, 0x1fc);
  const toxicFlags = header.readUInt32LE(0x1fc);
  const isToxic = toxicMagic === APA_TOXIC_MAGIC;
  return {
    magic,
    version: header.readUInt32LE(0x120),
    nsector: header.readUInt32LE(0x124),
    isToxic,
    toxicTwoSlice: isToxic && (toxicFlags & 0x01) !== 0,
  };
}

export function isValidMbrMagic(mbr: ApaMbrInfo): boolean {
  return mbr.magic === APA_MBR_MAGIC;
}

/**
 * Serializes a header to its 1 KiB on-disk form and stamps the checksum.
 * When `header.raw` is present it is used as the base so unmodeled fields
 * (MBR payload, DMS/Toxic boot data) survive read-modify-write edits;
 * otherwise the header is built on zeroed bytes.
 */
export function serializeApaHeader(header: ApaHeader): Buffer {
  const buf = header.raw
    ? Buffer.from(header.raw)
    : Buffer.alloc(APA_HEADER_BYTES);
  buf.writeUInt32LE(APA_MAGIC, 0x04);
  buf.writeUInt32LE(header.next, 0x08);
  buf.writeUInt32LE(header.prev, 0x0c);
  buf.fill(0, 0x10, 0x10 + APA_IDMAX);
  buf.write(header.id.slice(0, APA_IDMAX), 0x10, "latin1");
  buf.writeUInt32LE(header.start, 0x40);
  buf.writeUInt32LE(header.length, 0x44);
  buf.writeUInt16LE(header.type, 0x48);
  buf.writeUInt16LE(header.flags, 0x4a);
  buf.writeUInt32LE(header.nsub, 0x4c);
  writeDatetime(buf, 0x50, header.created);
  buf.writeUInt32LE(header.main, 0x58);
  buf.writeUInt32LE(header.number, 0x5c);
  buf.writeUInt32LE(header.modver, 0x60);
  buf.fill(0, 0x80, 0x80 + APA_NAMEMAX);
  buf.write(header.name.slice(0, APA_NAMEMAX), 0x80, "latin1");
  buf.fill(0, 0x200, 0x200 + APA_MAXSUB * 8);
  if (header.subs.length > APA_MAXSUB) {
    throw new Error(`Too many sub-partitions: ${header.subs.length}`);
  }
  for (let i = 0; i < header.subs.length; i++) {
    buf.writeUInt32LE(header.subs[i].start, 0x200 + i * 8);
    buf.writeUInt32LE(header.subs[i].length, 0x204 + i * 8);
  }
  const checksum = apaChecksum(buf);
  buf.writeUInt32LE(checksum, 0x00);
  header.checksum = checksum;
  return buf;
}

export function apaDatetimeNow(now: Date = new Date()): ApaDatetime {
  return {
    sec: now.getSeconds(),
    min: now.getMinutes(),
    hour: now.getHours(),
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

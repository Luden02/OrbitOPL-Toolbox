import { describe, expect, it } from "vitest";
import {
  apaChecksum,
  apaDatetimeNow,
  hasApaMagic,
  parseApaHeader,
  parseMbrInfo,
  serializeApaHeader,
} from "../src/hdd/apa/apa-codec";
import {
  APA_FLAG_SUB,
  APA_HEADER_BYTES,
  APA_MAGIC,
  APA_MBR_MAGIC,
  APA_MODVER,
  APA_TYPE_HDL,
  ApaHeader,
} from "../src/hdd/apa/apa-types";

function sampleHeader(): ApaHeader {
  return {
    checksum: 0,
    next: 262144,
    prev: 0,
    id: "PP.SLUS-12345..TEST_GAME",
    start: 524288,
    length: 262144,
    type: APA_TYPE_HDL,
    flags: 0,
    nsub: 2,
    created: { sec: 1, min: 2, hour: 3, day: 4, month: 5, year: 2026 },
    main: 0,
    number: 0,
    modver: APA_MODVER,
    name: "",
    subs: [
      { start: 1048576, length: 262144 },
      { start: 1310720, length: 262144 },
    ],
  };
}

describe("apaChecksum", () => {
  it("sums u32 words 1..255 little-endian", () => {
    const buf = Buffer.alloc(APA_HEADER_BYTES);
    buf.writeUInt32LE(0xdeadbeef, 0); // word 0 excluded
    buf.writeUInt32LE(1, 4);
    buf.writeUInt32LE(2, 8);
    buf.writeUInt32LE(0xffffffff, 1020);
    expect(apaChecksum(buf)).toBe((1 + 2 + 0xffffffff) >>> 0);
  });

  it("wraps modulo 2^32", () => {
    const buf = Buffer.alloc(APA_HEADER_BYTES);
    for (let i = 4; i < APA_HEADER_BYTES; i += 4) {
      buf.writeUInt32LE(0xffffffff, i);
    }
    expect(apaChecksum(buf)).toBe((255 * 0xffffffff) % 2 ** 32);
  });
});

describe("serialize/parse round-trip", () => {
  it("preserves every modeled field and stamps a valid checksum", () => {
    const header = sampleHeader();
    const buf = serializeApaHeader(header);
    expect(buf.length).toBe(APA_HEADER_BYTES);
    expect(hasApaMagic(buf)).toBe(true);
    expect(buf.readUInt32LE(4)).toBe(APA_MAGIC);
    expect(buf.readUInt32LE(0)).toBe(apaChecksum(buf));

    const parsed = parseApaHeader(buf);
    expect(parsed.next).toBe(header.next);
    expect(parsed.prev).toBe(header.prev);
    expect(parsed.id).toBe(header.id);
    expect(parsed.start).toBe(header.start);
    expect(parsed.length).toBe(header.length);
    expect(parsed.type).toBe(header.type);
    expect(parsed.flags).toBe(header.flags);
    expect(parsed.nsub).toBe(2);
    expect(parsed.subs).toEqual(header.subs);
    expect(parsed.created).toEqual(header.created);
    expect(parsed.main).toBe(0);
    expect(parsed.modver).toBe(APA_MODVER);
  });

  it("keeps unmodeled bytes when re-serializing from raw", () => {
    const header = sampleHeader();
    const buf = serializeApaHeader(header);
    buf.writeUInt32LE(0xcafebabe, 0x130); // MBR data_start region, unmodeled
    buf.writeUInt32LE(apaChecksum(buf), 0);

    const parsed = parseApaHeader(buf);
    parsed.id = "PP.SLUS-12345..RENAMED";
    const rewritten = serializeApaHeader(parsed);
    expect(rewritten.readUInt32LE(0x130)).toBe(0xcafebabe);
    expect(rewritten.readUInt32LE(0)).toBe(apaChecksum(rewritten));
    expect(parseApaHeader(rewritten).id).toBe("PP.SLUS-12345..RENAMED");
  });

  it("flags sub-partitions distinctly", () => {
    const header = sampleHeader();
    header.flags = APA_FLAG_SUB;
    header.main = 524288;
    header.number = 1;
    header.nsub = 0;
    header.subs = [];
    const parsed = parseApaHeader(serializeApaHeader(header));
    expect(parsed.flags & APA_FLAG_SUB).toBe(APA_FLAG_SUB);
    expect(parsed.main).toBe(524288);
    expect(parsed.number).toBe(1);
  });
});

describe("parseMbrInfo", () => {
  it("reads the Sony magic, version and sector count", () => {
    const buf = Buffer.alloc(APA_HEADER_BYTES);
    buf.write(APA_MBR_MAGIC, 0x100, "latin1");
    buf.writeUInt32LE(2, 0x120);
    buf.writeUInt32LE(78140160, 0x124);
    const mbr = parseMbrInfo(buf);
    expect(mbr.magic).toBe(APA_MBR_MAGIC);
    expect(mbr.version).toBe(2);
    expect(mbr.nsector).toBe(78140160);
    expect(mbr.isToxic).toBe(false);
    expect(mbr.toxicTwoSlice).toBe(false);
  });

  it("detects the ToxicOS APAEXT two-slice extension", () => {
    const buf = Buffer.alloc(APA_HEADER_BYTES);
    buf.write(APA_MBR_MAGIC, 0x100, "latin1");
    buf.write("APAEXT\0\0", 0x1f4, "latin1");
    buf.writeUInt32LE(1, 0x1fc);
    const mbr = parseMbrInfo(buf);
    expect(mbr.isToxic).toBe(true);
    expect(mbr.toxicTwoSlice).toBe(true);
  });
});

describe("apaDatetimeNow", () => {
  it("converts a JS date to APA fields", () => {
    const dt = apaDatetimeNow(new Date(2026, 6, 17, 9, 30, 45));
    expect(dt).toEqual({ sec: 45, min: 30, hour: 9, day: 17, month: 7, year: 2026 });
  });
});

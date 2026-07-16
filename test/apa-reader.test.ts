import { describe, expect, it } from "vitest";
import { MemoryBlockDevice, SECTOR_SIZE } from "../src/hdd/block-device";
import {
  apaChecksum,
  parseApaHeader,
  serializeApaHeader,
} from "../src/hdd/apa/apa-codec";
import { readPartitionMap, verifyApaRoot } from "../src/hdd/apa/apa-reader";
import { APA_HEADER_BYTES, ApaHeader } from "../src/hdd/apa/apa-types";
import { GiB, standardDisk } from "./fixtures/apa-image";

async function readHeader(dev: MemoryBlockDevice, sector: number): Promise<ApaHeader> {
  return parseApaHeader(await dev.read(sector * SECTOR_SIZE, APA_HEADER_BYTES));
}

async function writeHeader(dev: MemoryBlockDevice, header: ApaHeader): Promise<void> {
  await dev.write(header.start * SECTOR_SIZE, serializeApaHeader(header));
}

describe("verifyApaRoot", () => {
  it("accepts a freshly built Sony-formatted disk", async () => {
    const dev = await (await standardDisk()).commit();
    const check = await verifyApaRoot(dev);
    expect(check).toEqual({ ok: true });
  });

  it("rejects a blank disk", async () => {
    const dev = new MemoryBlockDevice(1 * GiB);
    const check = await verifyApaRoot(dev);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/not a PS2-formatted disk/i);
  });

  it("rejects a corrupted root checksum", async () => {
    const dev = await (await standardDisk()).commit();
    const raw = await dev.read(0, APA_HEADER_BYTES);
    raw.writeUInt32LE(raw.readUInt32LE(0) ^ 0xff, 0);
    await dev.write(0, raw);
    const check = await verifyApaRoot(dev);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/checksum/i);
  });

  it("rejects a disk without the Sony MBR magic string", async () => {
    const dev = await (await standardDisk()).commit();
    const raw = await dev.read(0, APA_HEADER_BYTES);
    raw.fill(0, 0x100, 0x120);
    raw.writeUInt32LE(apaChecksum(raw), 0);
    await dev.write(0, raw);
    const check = await verifyApaRoot(dev);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/MBR magic/i);
  });

  it("flags ToxicOS two-slice disks as read-only", async () => {
    const dev = await (await standardDisk()).commit();
    const raw = await dev.read(0, APA_HEADER_BYTES);
    raw.write("APAEXT\0\0", 0x1f4, "latin1");
    raw.writeUInt32LE(1, 0x1fc);
    raw.writeUInt32LE(apaChecksum(raw), 0);
    await dev.write(0, raw);
    const check = await verifyApaRoot(dev);
    expect(check.ok).toBe(true);
    expect(check.toxicTwoSlice).toBe(true);
  });
});

describe("readPartitionMap", () => {
  it("walks a clean system-only disk without problems", async () => {
    const dev = await (await standardDisk()).commit();
    const map = await readPartitionMap(dev);
    expect(map.problems).toEqual([]);
    expect(map.partitions.map((p) => p.id)).toEqual([
      "__mbr",
      "__net",
      "__system",
      "__sysconf",
      "__common",
    ]);
    expect(map.sectorCount).toBe((40 * GiB) / SECTOR_SIZE);
  });

  it("walks a disk containing a multi-partition game without problems", async () => {
    const builder = await standardDisk();
    await builder.addGame({
      title: "Test Game",
      startupId: "SLUS_123.45",
      sizeBytes: 4_617_089_024,
      runs: [
        [4194304, 4194304],
        [8388608, 4194304],
        [12582912, 2097152],
      ],
    });
    const dev = await builder.commit();
    const map = await readPartitionMap(dev);
    expect(map.problems).toEqual([]);
    expect(map.partitions).toHaveLength(8); // 5 system + main + 2 subs
  });

  it("throws on a completely blank device", async () => {
    const dev = new MemoryBlockDevice(1 * GiB);
    await expect(readPartitionMap(dev)).rejects.toThrow(/not an apa disk/i);
  });

  it("reports a bad checksum as a problem", async () => {
    const dev = await (await standardDisk()).commit();
    const second = await readHeader(dev, 262144);
    const raw = serializeApaHeader(second);
    raw.writeUInt32LE(raw.readUInt32LE(0) + 1, 0);
    await dev.write(262144 * SECTOR_SIZE, raw);

    const map = await readPartitionMap(dev);
    expect(map.problems.some((p) => /checksum/i.test(p.message))).toBe(true);
  });

  it("reports a stale prev pointer as repairable", async () => {
    const dev = await (await standardDisk()).commit();
    const third = await readHeader(dev, 524288);
    third.prev = 12345 * 256; // stale — simulates an interrupted commit
    await writeHeader(dev, third);

    const map = await readPartitionMap(dev);
    const prevProblems = map.problems.filter((p) => p.repairable);
    expect(prevProblems).toHaveLength(1);
    expect(prevProblems[0].sector).toBe(524288);
  });

  it("detects a chain loop instead of hanging", async () => {
    const dev = await (await standardDisk()).commit();
    const fourth = await readHeader(dev, 786432);
    fourth.next = 262144; // points back into the chain
    await writeHeader(dev, fourth);

    const map = await readPartitionMap(dev);
    expect(map.problems.some((p) => /loops back/i.test(p.message))).toBe(true);
  });

  it("reports a partition extending beyond the device", async () => {
    const dev = await (await standardDisk()).commit();
    const last = await readHeader(dev, 1048576);
    last.length = 262144 * 400; // 50 GiB worth of sectors on a 40 GiB disk
    await writeHeader(dev, last);

    const map = await readPartitionMap(dev);
    expect(map.problems.some((p) => /beyond the end/i.test(p.message))).toBe(true);
  });

  it("reports a broken chain (next points into nothing)", async () => {
    const dev = await (await standardDisk()).commit();
    const second = await readHeader(dev, 262144);
    second.next = 262144 * 3 + 4096; // no header there
    await writeHeader(dev, second);

    const map = await readPartitionMap(dev);
    expect(
      map.problems.some((p) => /no partition header there/i.test(p.message))
    ).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { MemoryBlockDevice, SECTOR_SIZE } from "../src/hdd/block-device";
import { NbdBlockDevice } from "../src/hdd/nbd/nbd-client";
import { NbdServer } from "../src/hdd/nbd/nbd-server";
import { readPartitionMap } from "../src/hdd/apa/apa-reader";
import { listHdlGames } from "../src/hdd/apa/hdl-meta";
import { GiB, MiB, standardDisk } from "./fixtures/apa-image";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function loopback(backing: MemoryBlockDevice, exportName = "hdd0") {
  const server = new NbdServer(backing, { exportName });
  const { port } = await server.listen();
  cleanups.push(() => server.close());
  const client = await NbdBlockDevice.connect({
    host: "127.0.0.1",
    port,
    exportName,
    timeoutMs: 5000,
  });
  cleanups.push(() => client.close());
  return { server, client };
}

describe("NBD client ↔ server loopback", () => {
  it("negotiates and reports the export size", async () => {
    const backing = new MemoryBlockDevice(1 * GiB);
    const { client } = await loopback(backing);
    expect(client.sizeBytes).toBe(1 * GiB);
    expect(client.readOnly).toBe(false);
  });

  it("round-trips reads and writes, including multi-chunk transfers", async () => {
    const backing = new MemoryBlockDevice(64 * MiB);
    const { client } = await loopback(backing);

    const small = Buffer.alloc(SECTOR_SIZE, 0xab);
    await client.write(0, small);
    expect(await client.read(0, SECTOR_SIZE)).toEqual(small);

    // Larger than the client's 256 KiB chunk size — must split transparently.
    const big = Buffer.alloc(1 * MiB);
    for (let i = 0; i < big.length; i += 4) big.writeUInt32LE(i, i);
    await client.write(8 * MiB, big);
    expect(await client.read(8 * MiB, big.length)).toEqual(big);
  });

  it("pipelines concurrent requests", async () => {
    const backing = new MemoryBlockDevice(64 * MiB);
    const { client } = await loopback(backing);
    await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        client.write(i * MiB, Buffer.alloc(SECTOR_SIZE, i + 1))
      )
    );
    const reads = await Promise.all(
      Array.from({ length: 16 }, (_, i) => client.read(i * MiB, SECTOR_SIZE))
    );
    reads.forEach((buf, i) => expect(buf[0]).toBe(i + 1));
  });

  it("rejects writes on a read-only export", async () => {
    const backing = new MemoryBlockDevice(64 * MiB, { readOnly: true });
    const { client } = await loopback(backing);
    expect(client.readOnly).toBe(true);
    await expect(client.write(0, Buffer.alloc(SECTOR_SIZE))).rejects.toThrow(/read-only/i);
  });

  it("rejects out-of-range reads locally", async () => {
    const backing = new MemoryBlockDevice(64 * MiB);
    const { client } = await loopback(backing);
    await expect(client.read(64 * MiB, SECTOR_SIZE)).rejects.toThrow(/beyond end/i);
  });

  it("refuses an unknown export name", async () => {
    const backing = new MemoryBlockDevice(64 * MiB);
    const server = new NbdServer(backing, { exportName: "hdd0" });
    const { port } = await server.listen();
    cleanups.push(() => server.close());
    await expect(
      NbdBlockDevice.connect({ host: "127.0.0.1", port, exportName: "nope", timeoutMs: 2000 })
    ).rejects.toThrow();
  });

  it("reads a full APA disk image over the wire", async () => {
    const builder = await standardDisk(8 * GiB);
    await builder.addGame({
      title: "Network Game",
      startupId: "SLPS_250.88",
      sizeBytes: 900 * MiB,
      runs: [[2097152, 2097152]],
    });
    const backing = await builder.commit();
    const { client } = await loopback(backing);

    const map = await readPartitionMap(client);
    expect(map.problems).toEqual([]);
    const { games } = await listHdlGames(client, map);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe("Network Game");
    expect(games[0].sizeBytes).toBe(900 * MiB);
  });
});

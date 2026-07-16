import { describe, expect, it } from "vitest";
import { SECTOR_SIZE } from "../src/hdd/block-device";
import {
  HDL_MEDIA_CD,
  HDL_MEDIA_DVD,
  buildHdlInfo,
  listHdlGames,
  parseHdlInfo,
  readHdlInfo,
} from "../src/hdd/apa/hdl-meta";
import { readPartitionMap } from "../src/hdd/apa/apa-reader";
import { GiB, MiB, standardDisk } from "./fixtures/apa-image";

describe("listHdlGames", () => {
  it("lists a single-partition game with correct metadata", async () => {
    const builder = await standardDisk();
    await builder.addGame({
      title: "Ico",
      startupId: "SCUS_971.13",
      sizeBytes: 700 * MiB,
      runs: [[2097152, 2097152]], // 1 GiB at the 1 GiB mark
      compatFlags: 0b101,
      dmaMode: 0x40 | 4,
      isDvd: false,
    });
    const dev = await builder.commit();
    const map = await readPartitionMap(dev);
    expect(map.problems).toEqual([]);

    const { games, skipped } = await listHdlGames(dev, map);
    expect(skipped).toEqual([]);
    expect(games).toHaveLength(1);
    const game = games[0];
    expect(game.title).toBe("Ico");
    expect(game.startupId).toBe("SCUS_971.13");
    expect(game.sizeBytes).toBe(700 * MiB);
    expect(game.allocBytes).toBe(1 * GiB);
    expect(game.compatFlags).toBe(0b101);
    expect(game.dmaMode).toBe(0x44);
    expect(game.mediaType).toBe(HDL_MEDIA_CD);
    expect(game.mainStart).toBe(2097152);
    expect(game.hidden).toBe(false);
  });

  it("lists a game spanning main + sub partitions and sums its size", async () => {
    const builder = await standardDisk();
    await builder.addGame({
      title: "Big DVD9 Game",
      startupId: "SLUS_123.45",
      sizeBytes: 4_617_089_024,
      runs: [
        [4194304, 4194304], // main, 2 GiB
        [8388608, 4194304], // sub, 2 GiB
        [12582912, 2097152], // sub, 1 GiB
      ],
    });
    const dev = await builder.commit();
    const map = await readPartitionMap(dev);
    const { games } = await listHdlGames(dev, map);
    expect(games).toHaveLength(1);
    expect(games[0].sizeBytes).toBe(4_617_089_024);
    expect(games[0].allocBytes).toBe(5 * GiB);
    expect(games[0].mediaType).toBe(HDL_MEDIA_DVD);
  });

  it("marks games in __ partitions as hidden", async () => {
    const builder = await standardDisk();
    await builder.addGame({
      title: "Hidden Game",
      startupId: "SLES_500.00",
      sizeBytes: 100 * MiB,
      runs: [[2097152, 262144]],
      partitionId: "__.SLES-50000..HIDDEN_GAME",
    });
    const dev = await builder.commit();
    const map = await readPartitionMap(dev);
    const { games } = await listHdlGames(dev, map);
    expect(games[0].hidden).toBe(true);
  });

  it("skips a game whose info block is corrupted instead of failing", async () => {
    const builder = await standardDisk();
    await builder.addGame({
      title: "Broken",
      startupId: "SLUS_999.99",
      sizeBytes: 100 * MiB,
      runs: [[2097152, 262144]],
    });
    const dev = await builder.commit();
    // wipe the info block's magic
    await dev.write(2097152 * SECTOR_SIZE + 0x101000, Buffer.alloc(SECTOR_SIZE));
    const map = await readPartitionMap(dev);
    const { games, skipped } = await listHdlGames(dev, map);
    expect(games).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/deadfeed/i);
  });
});

describe("buildHdlInfo", () => {
  it("encodes the data-area table exactly like hdl-dump", async () => {
    const builder = await standardDisk();
    const main = await builder.addGame({
      title: "Big DVD9 Game",
      startupId: "SLUS_123.45",
      sizeBytes: 4_617_089_024, // 4508876 KiB
      runs: [
        [4194304, 4194304],
        [8388608, 4194304],
        [12582912, 2097152],
      ],
    });
    const dev = await builder.commit();
    const info = await readHdlInfo(dev, main.start);

    expect(info.parts).toHaveLength(3);
    // main: data at start+0x2000, capacity (len-0x2000)/2 KiB = 2093056
    expect(info.parts[0]).toEqual({
      offset: 0,
      startShr8: (4194304 + 0x2000) >> 8,
      sizeKb4: 2093056 * 4,
    });
    // sub 1: full capacity (len-0x800)/2 KiB = 2096128
    expect(info.parts[1]).toEqual({
      offset: (4194304 - 0x2000) / 1024,
      startShr8: (8388608 + 0x800) >> 8,
      sizeKb4: 2096128 * 4,
    });
    // sub 2: the remainder
    const remainderKb = 4_617_089_024 / 1024 - 2093056 - 2096128;
    expect(info.parts[2]).toEqual({
      offset: (4194304 - 0x2000) / 1024 + (4194304 - 0x800) / 1024,
      startShr8: (12582912 + 0x800) >> 8,
      sizeKb4: remainderKb * 4,
    });
  });

  it("round-trips through parseHdlInfo", async () => {
    const main = {
      checksum: 0,
      next: 0,
      prev: 0,
      id: "PP.TEST",
      start: 2097152,
      length: 2097152,
      type: 0x1337,
      flags: 0,
      nsub: 0,
      created: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2026 },
      main: 0,
      number: 0,
      modver: 0x201,
      name: "",
      subs: [],
    };
    const block = buildHdlInfo(
      {
        title: "Round Trip",
        startupId: "SCES_503.60",
        compatFlags: 0xff,
        dmaMode: 0x21,
        layerBreak: 2084960,
        isDvd: true,
      },
      main,
      500000
    );
    const info = parseHdlInfo(block);
    expect(info.title).toBe("Round Trip");
    expect(info.startupId).toBe("SCES_503.60");
    expect(info.compatFlags).toBe(0xff);
    expect(info.dmaMode).toBe(0x21);
    expect(info.layerBreak).toBe(2084960);
    expect(info.mediaType).toBe(HDL_MEDIA_DVD);
    expect(info.parts).toHaveLength(1);
  });

  it("throws when the game does not fit the allocated partitions", () => {
    const main = {
      checksum: 0,
      next: 0,
      prev: 0,
      id: "PP.TINY",
      start: 262144,
      length: 262144, // 128 MiB => ~124 MiB usable
      type: 0x1337,
      flags: 0,
      nsub: 0,
      created: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2026 },
      main: 0,
      number: 0,
      modver: 0x201,
      name: "",
      subs: [],
    };
    expect(() =>
      buildHdlInfo(
        {
          title: "Too Big",
          startupId: "SLUS_000.00",
          compatFlags: 0,
          dmaMode: 0,
          layerBreak: 0,
          isDvd: true,
        },
        main,
        200 * 1024 // 200 MiB in KiB
      )
    ).toThrow(/does not fit/i);
  });
});

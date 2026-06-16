#!/usr/bin/env node
//
// Cross-platform dispatcher for the contributor setup scripts.
// Picks scripts/setup.ps1 on Windows and scripts/setup.sh elsewhere.
//
// Note: this requires Node.js to already be installed. If you don't have
// Node yet, run the platform script directly:
//   macOS / Linux:  ./scripts/setup.sh
//   Windows:        powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
//
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const here = __dirname;
const isWin = process.platform === "win32";

const cmd = isWin ? "powershell" : "bash";
const args = isWin
  ? ["-ExecutionPolicy", "Bypass", "-File", path.join(here, "setup.ps1")]
  : [path.join(here, "setup.sh")];

const res = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(res.status ?? 1);

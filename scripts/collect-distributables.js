const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const outputDir = path.join(buildDir, 'release');
const extensions = ['.exe', '.dmg', '.AppImage', '.deb', '.zip'];

// Unpacked app trees emitted by electron-builder (win-unpacked/, linux-unpacked/,
// mac/, mac-arm64/). They hold loose executables (the app exe, elevate.exe) that
// are not standalone distributables, so skip them entirely.
const isUnpackedDir = name =>
  name.endsWith('-unpacked') || name === 'mac' || name === 'mac-arm64';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function collectFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === outputDir || isUnpackedDir(entry.name)) continue;
      collectFiles(fullPath);
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      const dest = path.join(outputDir, entry.name);
      fs.copyFileSync(fullPath, dest);
      console.log(`Collected: ${entry.name}`);
    }
  }
}

collectFiles(buildDir);
console.log(`\nAll distributables collected in: ${outputDir}`);

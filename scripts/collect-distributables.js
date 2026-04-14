const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const outputDir = path.join(buildDir, 'release');
const extensions = ['.exe', '.dmg', '.AppImage', '.deb', '.zip'];

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function collectFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && fullPath !== outputDir) {
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

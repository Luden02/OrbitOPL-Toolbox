![Logo](angular/public/logo.svg)

OrbitOPL Toolbox – A modern, cross-platform way to manage your OPL game collection.

# 📖 About

OrbitOPL Toolbox is an open-source, cross-platform desktop application for organizing your PlayStation 2 (and PlayStation 1) game library for use with [Open PS2 Loader (OPL)](https://github.com/ps2homebrew/Open-PS2-Loader).

It was created to fill the gap left by OPLManager, which lacks macOS and Linux support.
The goal isn’t to replace OPLManager, but to offer an alternative — one that’s modern, intuitive, and built with technologies familiar to JavaScript developers.

> Built with Electron + Angular, styled with Tailwind CSS & daisyUI. Cross-platform: **Windows, macOS, and Linux**.

# ✨ Features

### 🎮 Multi-system library

- Manage **PS2** (DVD & CD), **PS1**, and **APPS** (homebrew) all in one place
- Library viewer with **search**, **sort** (by title or game ID), and **grid / list** view modes
- At-a-glance **library stats**: game counts per system and total size on disk
- Recognizes **UL** (split / fragmented) games

### 📥 Importing

- **PS2 DVD** — import `ISO` / `ZSO` images
- **PS2 CD** — convert `CUE`/`BIN` (including multi-track) to a single `ISO`
- **PS1** — convert `CUE`/`BIN` to `VCD` and auto-generate a **POPStarter** launcher
- **APPS** — import homebrew `ELF` executables with a custom title
- **Automatic game-ID detection** by scanning the disc image (no need to look it up manually)
- **Queued batch imports** with live progress for long operations

### 🖼️ Artwork

- Download cover, icon, and screenshot art (`COV` / `ICO` / `SCR`) for **PS1 & PS2**
- Fetch art for a **single game** or for your **entire library** in one click
- Sourced from the [PSX / PS2 OPL Art Database](https://github.com/Luden02/psx-ps2-opl-art-database)

### 🗜️ Compression

- Compress PS2 `ISO` → `ZSO` (LZ4) to save disk space — single game or **bulk** the whole library
- Optionally delete the original `ISO` after compression

### ⚙️ Per-game configuration

- Edit OPL per-game settings (`CFG/<GAMEID>.cfg`) directly from the UI
- Set the **display title**, toggle **compatibility modes**, and assign **VMC** slots
- Unknown / OPL-written keys are preserved

### 💾 Virtual Memory Cards (VMC)

- Create, list, and delete OPL-compatible virtual memory cards (8 / 16 / 32 / 64 MB)

### 🧹 File maintenance

- **Invalid-file detection** for malformed or wrongly-named files
- **Bulk auto-correction** — discover game IDs and rename in one pass, with optional artwork download
- **Rename to convention** — switch between the legacy (`GAMEID_Title.iso`) and new OPL naming styles
- **Safe delete** — removes the game image, its artwork, and any paired PS1 launcher

### 🛠️ Quality of life

- **Auto-reconnect** to your last library on launch
- Real-time **logs** viewer with verbose mode and export
- Built-in **update check**
- Window-close guard while an import is in progress

# 💻 Installation

Grab the latest build from the [Releases](https://github.com/Luden02/OrbitOPL-Toolbox/releases) page.

### 🐧 Linux

1. Download the **`.AppImage`**, **`.deb`**, or **`.zip`** (whichever suits your distro).
2. For the AppImage: make it executable and run it. For the `.deb`: install it with your package manager. For the `.zip`: extract and run the `OrbitOPLToolbox` binary.

---

### 🍏 macOS

1. Download the `.dmg` for your architecture:
   - **arm64** (Apple Silicon — _recommended and tested_)
   - **x64** (Intel Macs)
2. Open the `.dmg` and drag **OrbitOPLToolbox** to your **Applications** folder.
3. Because the app is **unsigned** (but **100% safe**), macOS quarantines it. Remove the quarantine flag by running this in your **terminal**:
   ```bash
   xattr -dr com.apple.quarantine /Applications/OrbitOPLToolbox.app
   ```
4. **Run** the app.

---

### 🪟 Windows

1. Download the portable `.exe`.
2. **Run it.**
3. If **SmartScreen** appears, click **"More info" → "Run anyway"** (the app is 100% safe).

# 🚀 Getting Started

1. Launch OrbitOPL Toolbox.
2. Select your OPL library root folder (an internal directory or an external/USB drive).
3. Browse, import, compress, and manage your collection from the UI.
4. Enjoy! 🎉

# 📜 License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.

# 🤝 Contributing

Contributions are welcome! Here's how you can help improve OrbitOPL Toolbox:

## Ways to Contribute

- **Bug Reports**: Found an issue? Open a bug report with detailed steps to reproduce.
- **Feature Requests**: Have an idea for improvement? Submit a feature request.
- **Code Contributions**: Submit pull requests for bug fixes or new features.
- **Testing**: Test new releases and provide feedback.

## Pull Request Process

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes and commit them with clear messages.
4. Push to your fork and submit a pull request.
5. Ensure your code follows the project's coding standards.

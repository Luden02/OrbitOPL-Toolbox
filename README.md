![Logo](angular/public/logo.svg)

OrbitOPL Toolbox – A modern, cross-platform way to manage your OPL game collection.

# 📖 About

OrbitOPL Toolbox is an open-source and cross-platform application for organizing your PlayStation 2 game library.

It was created to fill the gap left by OPLManager, which lacks macOS and Linux support.
The goal isn’t to replace OPLManager, but to offer an alternative — one that’s modern, intuitive, and built with technologies familiar to JavaScript developers.

# ✨ Features

## ✅ Current

- Cross-Platform: Windows, macOS, and Linux support
- ISO files Support
- Modern UI: Built with Electron for a clean, user-friendly experience
- Game artwork: "Single/Bulk GameArt Download" Functionality

## 🚧 Roadmap

### Short Term

- Single-file & batch game import (.iso / .bin.cue)
- Auto-rename imports to pattern-based .iso
- Search & filter games

### Long Term

- PS1 and APPS support
- Cheats management
- CFG support (TBD)
- Additional community-requested features

📝 The roadmap evolves based on feedback and development priorities.

## 💻 Installation

Grab the latest release from the Releases page. [Releases](https://github.com/StefanAdrianNita/OrbitOPL-Toolbox/releases) page.

### 🐧 Linux

1. Download the **Linux `.zip`** file.
2. Extract it.
3. Run the `OrbitOPL-Toolbox` file.

---

### 🍏 macOS

1. Download the `.dmg` file for your architecture:
   - **x64** (Intel Macs)
   - **arm64** (Apple Silicon — _recommended and tested_)
2. Open the `.dmg` file.
3. Drag **CrossOPL Toolbox** to your **Applications** folder.
4. Run the app.

---

### 🪟 Windows

1. Download the `setup.exe`.
2. Run it — after some loading time, you'll find the app on your **Desktop**.  
   _(A fully portable `.exe` might not be available yet.)_

## 🚀 Getting Started

1. Launch OrbitOPL-Toolbox
2. Select your OPL Library root folder (internal directory or external drive)
3. Use the interface to see, and manage your game collection
4. Enjoy!

# 📜 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

# 🤝 Contributing

Contributions are welcome! Here's how you can help improve OrbitOPL Toolbox:

## Ways to Contribute

- **Bug Reports**: Found an issue? Please open a bug report with detailed steps to reproduce
- **Feature Requests**: Have an idea for improvement? Submit a feature request
- **Code Contributions**: Submit pull requests for bug fixes or new features
- **Testing**: Test new releases and provide feedback

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/Luden02/OrbitOPL-Toolbox.git
   cd OrbitOPL-Toolbox
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run start
   ```

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes and commit them with clear messages
4. Push to your fork and submit a pull request
5. Ensure your code follows the project's coding standards

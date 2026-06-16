#!/usr/bin/env bash
#
# OrbitOPL Toolbox — first-time contributor setup (macOS & Linux)
#
# Detects the host OS / package manager and installs everything needed to
# develop the app, then installs the npm dependencies for both the Electron
# root project and the Angular renderer.
#
# Usage:  ./scripts/setup.sh        (or:  npm run setup)
#
set -euo pipefail

# ── Required tool versions ──────────────────────────────────────────────────
NODE_MAJOR_MIN=20   # Angular 21 needs Node 20.19+, 22.12+, or 24+

# ── Pretty output helpers ───────────────────────────────────────────────────
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m• %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

have() { command -v "$1" >/dev/null 2>&1; }

# ── OS / package-manager detection ──────────────────────────────────────────
OS="$(uname -s)"
PKG=""           # the package manager command we will use
INSTALL=""       # the "install" sub-command

detect_pkg_manager() {
  case "$OS" in
    Darwin)
      PKG="brew"; INSTALL="brew install"
      if ! have brew; then
        warn "Homebrew is not installed."
        info "Install it from https://brew.sh and re-run this script:"
        info '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        exit 1
      fi
      ;;
    Linux)
      if   have apt-get; then PKG="apt";    INSTALL="sudo apt-get install -y";   sudo apt-get update -y >/dev/null 2>&1 || true
      elif have dnf;     then PKG="dnf";    INSTALL="sudo dnf install -y"
      elif have pacman;  then PKG="pacman"; INSTALL="sudo pacman -S --noconfirm"
      elif have zypper;  then PKG="zypper"; INSTALL="sudo zypper install -y"
      else
        err "No supported package manager found (apt, dnf, pacman, zypper)."
        err "Please install Node.js ${NODE_MAJOR_MIN}+ and Git manually, then re-run."
        exit 1
      fi
      ;;
    *)
      err "Unsupported OS: $OS. On Windows use scripts/setup.ps1 instead."
      exit 1
      ;;
  esac
}

# ── Node version check ──────────────────────────────────────────────────────
node_ok() {
  have node || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge "$NODE_MAJOR_MIN" ]
}

install_node() {
  if node_ok; then
    ok "Node.js $(node --version) already satisfies the requirement (>= ${NODE_MAJOR_MIN})."
    return
  fi
  if have node; then
    warn "Node.js $(node --version) is too old (need >= ${NODE_MAJOR_MIN}). Installing a newer version."
  else
    info "Node.js not found — installing."
  fi
  case "$PKG" in
    brew)   brew install node ;;
    apt)
      # NodeSource gives an up-to-date LTS; distro repos are often too old.
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;
    dnf)    sudo dnf install -y nodejs npm ;;
    pacman) sudo pacman -S --noconfirm nodejs npm ;;
    zypper) sudo zypper install -y nodejs npm ;;
  esac
  node_ok || { err "Node.js install did not produce a version >= ${NODE_MAJOR_MIN}."; exit 1; }
  ok "Node.js $(node --version) installed."
}

# ── Generic "ensure a tool exists" helper ───────────────────────────────────
ensure() {
  local bin="$1" pkg="$2" label="${3:-$2}"
  if have "$bin"; then
    ok "$label is present."
  else
    info "Installing $label."
    $INSTALL "$pkg"
    ok "$label installed."
  fi
}

# ── Main ────────────────────────────────────────────────────────────────────
bold "OrbitOPL Toolbox — contributor setup ($OS)"
detect_pkg_manager
info "Using package manager: $PKG"

install_node
ensure git git Git

# binutils provides GNU 'ar', required to build the Linux .deb package.
# Harmless to have everywhere; only the packaging step actually needs it.
case "$PKG" in
  brew)            ensure ar binutils "binutils (for .deb packaging)" ;;
  apt|dnf|zypper)  ensure ar binutils "binutils (for .deb packaging)" ;;
  pacman)          ensure ar binutils "binutils (for .deb packaging)" ;;
esac

# ── npm dependencies (root + angular) ───────────────────────────────────────
bold "Installing npm dependencies"
info "Root (Electron) project…"
( cd "$ROOT_DIR" && npm install )
ok "Root dependencies installed."

info "Angular renderer…"
( cd "$ROOT_DIR/angular" && npm install )
ok "Angular dependencies installed."

bold "✅ Setup complete!"
echo
echo "Next steps:"
echo "  npm run app:serve   # start the app in dev mode (hot reload)"
echo "  npm start           # build once and launch"

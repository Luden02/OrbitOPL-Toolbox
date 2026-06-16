#
# OrbitOPL Toolbox - first-time contributor setup (Windows)
#
# Detects winget (or Chocolatey) and installs everything needed to develop
# the app, then installs the npm dependencies for both the Electron root
# project and the Angular renderer.
#
# Usage (from a PowerShell prompt in the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
#   - or -   npm run setup
#
$ErrorActionPreference = "Stop"

$NodeMajorMin = 20   # Angular 21 needs Node 20.19+, 22.12+, or 24+

function Write-Bold($m) { Write-Host $m -ForegroundColor White }
function Write-Info($m) { Write-Host "* $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "+ $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "x $m" -ForegroundColor Red }

function Test-Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

$RootDir = Split-Path -Parent $PSScriptRoot

# --- Package manager detection ------------------------------------------------
$Pkg = $null
if (Test-Have winget) {
    $Pkg = "winget"
} elseif (Test-Have choco) {
    $Pkg = "choco"
} else {
    Write-Warn "Neither winget nor Chocolatey was found."
    Write-Info "winget ships with modern Windows (App Installer). Install it from the"
    Write-Info "Microsoft Store, or install Chocolatey from https://chocolatey.org/install"
    Write-Info "then re-run this script. Alternatively install Node.js $NodeMajorMin+ and Git manually."
    exit 1
}
Write-Bold "OrbitOPL Toolbox - contributor setup (Windows)"
Write-Info "Using package manager: $Pkg"

function Install-Pkg($wingetId, $chocoId) {
    if ($Pkg -eq "winget") {
        winget install --silent --accept-source-agreements --accept-package-agreements -e --id $wingetId
    } else {
        choco install $chocoId -y
    }
    # Refresh PATH so freshly-installed tools are visible in this session.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# --- Node.js ------------------------------------------------------------------
function Test-NodeOk {
    if (-not (Test-Have node)) { return $false }
    $major = [int](node -p "process.versions.node.split('.')[0]")
    return ($major -ge $NodeMajorMin)
}

if (Test-NodeOk) {
    Write-Ok "Node.js $(node --version) already satisfies the requirement (>= $NodeMajorMin)."
} else {
    if (Test-Have node) {
        Write-Warn "Node.js $(node --version) is too old (need >= $NodeMajorMin). Installing a newer LTS."
    } else {
        Write-Info "Node.js not found - installing LTS."
    }
    Install-Pkg "OpenJS.NodeJS.LTS" "nodejs-lts"
    if (-not (Test-NodeOk)) {
        Write-Err "Node.js install did not produce a version >= $NodeMajorMin. You may need to open a new terminal and re-run."
        exit 1
    }
    Write-Ok "Node.js $(node --version) installed."
}

# --- Git ----------------------------------------------------------------------
if (Test-Have git) {
    Write-Ok "Git is present."
} else {
    Write-Info "Installing Git."
    Install-Pkg "Git.Git" "git"
    Write-Ok "Git installed."
}

# --- npm dependencies (root + angular) ---------------------------------------
Write-Bold "Installing npm dependencies"
Write-Info "Root (Electron) project..."
Push-Location $RootDir
npm install
Pop-Location
Write-Ok "Root dependencies installed."

Write-Info "Angular renderer..."
Push-Location (Join-Path $RootDir "angular")
npm install
Pop-Location
Write-Ok "Angular dependencies installed."

Write-Bold "Setup complete!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  npm run app:serve   # start the app in dev mode (hot reload)"
Write-Host "  npm start           # build once and launch"

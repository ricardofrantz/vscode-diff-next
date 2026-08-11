#requires -Version 5.1
<#
.SYNOPSIS
  Rebuild vscode-diff Next, install into VS Code, restart the editor.

.DESCRIPTION
  Default path (installed extension, like production):
    compile -> package VSIX -> code --install-extension --force -> restart Code

  Faster day-to-day loop (no VSIX, no reinstall):
    .\update-extension.ps1 -DevHost
    Then edit + npm run watch; in the Extension Host window: Ctrl+R (Reload Window).

.PARAMETER DevHost
  Compile, then open Extension Development Host on this folder. Skips VSIX and reinstall.

.PARAMETER NoRestart
  Install the VSIX but do not kill/relaunch Code. Reload Window yourself (Ctrl+R / Cmd+R).

.PARAMETER SkipInstall
  Compile + package only. Leave VSIX on disk.

.PARAMETER CodeCmd
  CLI to use (default: code). Example: code.cmd full path, or cursor if present.

.PARAMETER Workspace
  Folder or .code-workspace to reopen after restart. Default: this repo.
  Pass empty string to reopen Code with no folder.

.EXAMPLE
  .\update-extension.ps1
  .\update-extension.ps1 -NoRestart
  .\update-extension.ps1 -DevHost
  .\update-extension.ps1 -Workspace C:\Users\RicardoFrantz\ShapeSolver-2.6.0
#>
[CmdletBinding()]
param(
    [switch] $DevHost,
    [switch] $NoRestart,
    [switch] $SkipInstall,
    [string] $CodeCmd = "code",
    [string] $Workspace
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Write-Step([string] $Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Assert-Command([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Command not found: $Name. Install Node/npm or add VS Code 'code' to PATH."
    }
}

function Get-PackageVersion {
    $pkgPath = Join-Path $Root "package.json"
    $pkg = Get-Content -Raw -Path $pkgPath | ConvertFrom-Json
    return [string] $pkg.version
}

function Invoke-Native {
    # Run an external command; log to host only (do not leak into function return).
    param([scriptblock] $Block)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Block 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Host $_.Exception.Message
            }
            else {
                Write-Host $_
            }
        }
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            throw "Command failed (exit $LASTEXITCODE)"
        }
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Invoke-Compile {
    Write-Step "Compile (tsc)"
    Push-Location $Root
    try {
        Invoke-Native { npm run compile }
    }
    finally {
        Pop-Location
    }
}

function Invoke-Package {
    Write-Step "Package VSIX"
    Push-Location $Root
    try {
        # Prefer local vsce if present; else npx.
        # Include production dependencies (e.g. simple-git). Do not pass --no-dependencies.
        $vsce = Join-Path $Root "node_modules\.bin\vsce.cmd"
        if (Test-Path $vsce) {
            Invoke-Native { & $vsce package }
        }
        else {
            Invoke-Native { npx --yes @vscode/vsce package }
        }
    }
    finally {
        Pop-Location
    }

    $version = Get-PackageVersion
    $name = (Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json).name
    $vsix = Join-Path $Root "$name-$version.vsix"
    if (-not (Test-Path $vsix)) {
        $hit = Get-ChildItem -Path $Root -Filter "*.vsix" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($hit) { $vsix = $hit.FullName }
    }
    if (-not $vsix -or -not (Test-Path -LiteralPath $vsix)) {
        throw "VSIX not found after package."
    }
    Write-Host "VSIX: $vsix"
    # Unary comma: single return object; avoids merging with prior streams.
    return , $vsix
}

function Invoke-Install([string] $VsixPath) {
    Write-Step "Install extension ($CodeCmd)"
    Assert-Command $CodeCmd
    if (-not (Test-Path -LiteralPath $VsixPath)) {
        throw "VSIX path not found: $VsixPath"
    }
    Write-Host "Installing: $VsixPath"
    Invoke-Native { & $CodeCmd --install-extension $VsixPath --force }
}

function Stop-VsCodeProcesses {
    # Electron main + helpers. "Code" is the usual Windows process name for VS Code.
    $names = @("Code", "Code - Insiders", "Code - OSS")
    foreach ($n in $names) {
        Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "Stopping $($_.ProcessName) pid=$($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    # Brief wait so file locks on the extension dir release.
    Start-Sleep -Seconds 1.5
}

function Start-VsCode([string] $Target) {
    Write-Step "Start $CodeCmd"
    Assert-Command $CodeCmd
    if ($null -eq $Target -or $Target -eq "") {
        Start-Process -FilePath $CodeCmd
    }
    else {
        Start-Process -FilePath $CodeCmd -ArgumentList @($Target)
    }
}

function Open-DevHost {
    Write-Step "Open Extension Development Host"
    Assert-Command $CodeCmd
    # Loads this folder as an extension; webview/ts live-edit after compile + host reload.
    & $CodeCmd --extensionDevelopmentPath=$Root $Root
    if ($LASTEXITCODE -ne 0) {
        # Start-Process style fallback when `code` is a batch shim that returns oddly.
        Start-Process -FilePath $CodeCmd -ArgumentList @(
            "--extensionDevelopmentPath=$Root",
            $Root
        )
    }
    Write-Host ""
    Write-Host "Dev loop:" -ForegroundColor Green
    Write-Host "  1. In another terminal:  npm run watch"
    Write-Host "  2. Edit src/ ..."
    Write-Host "  3. In the Extension Host window:  Ctrl+R  (Developer: Reload Window)"
    Write-Host "No VSIX, no reinstall, no full restart."
}

# --- main ---
Assert-Command "npm"
Set-Location $Root

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Step "npm install (node_modules missing)"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

if ($PSBoundParameters.ContainsKey("Workspace")) {
    $reopen = $Workspace
}
else {
    $reopen = $Root
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()

if ($DevHost) {
    Invoke-Compile
    Open-DevHost
    $sw.Stop()
    Write-Host ""
    Write-Host "Done in $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s (DevHost)." -ForegroundColor Green
    exit 0
}

Invoke-Compile

if ($SkipInstall) {
    $vsix = Invoke-Package
    $sw.Stop()
    Write-Host ""
    Write-Host "Packaged only: $vsix ($([math]::Round($sw.Elapsed.TotalSeconds, 1)) s)" -ForegroundColor Green
    exit 0
}

$vsix = Invoke-Package
Invoke-Install $vsix

if ($NoRestart) {
    $sw.Stop()
    Write-Host ""
    Write-Host "Installed. Reload Window in VS Code (Ctrl+R or Command Palette)." -ForegroundColor Green
    Write-Host "Done in $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s." -ForegroundColor Green
    exit 0
}

Write-Step "Restart VS Code"
Stop-VsCodeProcesses
Start-VsCode $reopen

$sw.Stop()
Write-Host ""
Write-Host "Installed + restarted in $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s." -ForegroundColor Green
Write-Host "Extension: RicardoFrantz.diff-next  |  VSIX: $(Split-Path $vsix -Leaf)"
Write-Host "Reopened: $reopen"

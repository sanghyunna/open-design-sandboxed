#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
    Build the self-contained Windows portable zip of Open Design.

.DESCRIPTION
    Produces a portable artifact that runs on a bare Windows x64 machine with NO
    npm / Node / git installed — only the two external agent CLIs (codex,
    cursor-agent) need to be on PATH in the target environment.

    What --portable guarantees (apps/packaged/src/config.ts + updater-env.ts +
    tools/pack/src/win/*):
      - all runtime data lands beside the extracted exe
        (<exeDir>\OpenDesignData\namespaces), never %APPDATA% or the registry
      - the auto-updater defaults OFF: the baked `portable: true` flag makes the
        runtime set OD_UPDATE_ENABLED=0 (apps/packaged/src/updater-env.ts), so
        accepting an update can't silently convert the portable copy into an
        NSIS / %LOCALAPPDATA% install. (An explicit OD_UPDATE_ENABLED still wins.)

    This machine's system Node is v22 (violates engines ~24), so the script
    forces the portable Node 24 toolchain onto PATH. better-sqlite3 is rebuilt
    to Electron's ABI during the build via @electron/rebuild (VS Build Tools
    2022 are installed here). The 16 workspace packages build in parallel via
    pnpm's topological scheduler (tools/pack/src/win/app.ts).

    BUILD SPEED — Windows Defender (build-machine only):
      The single biggest cost on a fresh machine is Defender real-time scanning
      every file under the build tree. Proven here: an identical 15,376-file zip
      dropped 655s -> 59s purely from excluding .tmp. If a build feels
      pathologically slow (tens of minutes for a ~250 MB app), exclude these on
      the BUILD machine from an ADMIN PowerShell (or push via GPO/Intune for a
      shared build box):
        Add-MpPreference -ExclusionPath `
          'D:\dev\open_design_port\open-design\.tmp', `
          'D:\dev\open_design_port\open-design\node_modules', `
          "$env:LOCALAPPDATA\electron-builder\Cache", `
          "$env:LOCALAPPDATA\npm-cache", "$env:LOCALAPPDATA\pnpm-cache", `
          'D:\.pnpm-store', 'D:\dev\open_design_port\.tools\node24'
      (Already applied on THIS machine. `pnpm store path` prints the store dir if
      it differs.) End users who only run the zip are unaffected — they pay at
      most a one-time first-launch scan on their own machine, not the build tax.

    DATA DIRECTORY is a RUNTIME concern, not a build flag:
      Portable data defaults to <exeDir>\OpenDesignData. To relocate it, the END
      USER sets OD_DATA_DIR when launching the extracted exe — it always wins
      over the portable fallback. It is intentionally NOT baked at build time
      (that would hardcode a path into a "portable" artifact), so there is no
      -DataDir flag. The win packaging never reads OD_DATA_DIR at build time.

.PARAMETER Namespace
    Runtime namespace baked into the artifact. Default: rg.

.PARAMETER To
    Build target: zip (default) | all | dir | nsis.
      zip -> portable zip only (the deliverable; skips the slow NSIS makensis)
      all -> packaged dir + NSIS installer + portable zip
    Keep 'zip' unless you also need the NSIS installer.

.EXAMPLE
    .\build-portable.ps1
    .\build-portable.ps1 -To all
#>
[CmdletBinding()]
param(
    [string]$Namespace = "rg",
    [ValidateSet("zip", "all", "dir", "nsis")]
    [string]$To = "zip"
)

$ErrorActionPreference = "Stop"

# Project root = this script's directory.
$ProjectRoot = $PSScriptRoot
# Portable Node 24 toolchain (required: system Node here is v22, repo needs ~24).
$Node24 = "D:\dev\open_design_port\.tools\node24"

Write-Host "=== Open Design portable build ===" -ForegroundColor Cyan
Write-Host "Project root : $ProjectRoot"
Write-Host "Namespace    : $Namespace"
Write-Host "Target (--to): $To"

# --- 1. Force the Node 24 toolchain onto PATH -------------------------------
if (-not (Test-Path (Join-Path $Node24 "node.exe"))) {
    throw "Portable Node 24 not found at '$Node24'. Update `$Node24 in this script."
}
$env:Path = "$Node24$([IO.Path]::PathSeparator)$env:Path"

$nodeVersion = & "$Node24\node.exe" --version
if ($nodeVersion -notmatch '^v24\.') {
    throw "Expected Node v24.x from the portable toolchain but got '$nodeVersion'."
}
Write-Host "Node         : $nodeVersion (from $Node24)" -ForegroundColor Green

# --- 2. Build the portable artifact -----------------------------------------
# tools-pack win build also (re)builds the 16 workspace packages and rebuilds
# better-sqlite3 to the Electron ABI. Watch the log for:
#   "[tools-pack] rebuilding Electron ABI modules: better-sqlite3"
$buildArgs = @("tools-pack", "win", "build", "--to", $To, "--namespace", $Namespace, "--portable")
Write-Host ""
Write-Host "Running: pnpm $($buildArgs -join ' ')" -ForegroundColor Cyan
Write-Host ""

$sw = [Diagnostics.Stopwatch]::StartNew()
Push-Location $ProjectRoot
try {
    & "$Node24\pnpm.cmd" @buildArgs
    $exit = $LASTEXITCODE
}
finally {
    Pop-Location
}
$sw.Stop()

$elapsed = "{0:n1} min" -f $sw.Elapsed.TotalMinutes
if ($exit -ne 0) {
    throw "Build failed with exit code $exit after $elapsed."
}

# --- 3. Report the artifact -------------------------------------------------
Write-Host ""
Write-Host "=== Build complete in $elapsed ===" -ForegroundColor Green

$nsDir = Join-Path $ProjectRoot ".tmp\tools-pack\out\win\namespaces\$Namespace"
$zip = Get-ChildItem -Path $nsDir -Recurse -Filter "*-portable.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($zip) {
    $zipMB = [math]::Round($zip.Length / 1MB, 1)
    Write-Host "Portable zip : $($zip.FullName)" -ForegroundColor Green
    Write-Host "Size         : $zipMB MB" -ForegroundColor Green
} elseif ($To -eq "nsis" -or $To -eq "dir") {
    Write-Host "(No portable zip for --to '$To'; that's expected.)" -ForegroundColor Yellow
} else {
    Write-Host "Portable zip not found under $nsDir — check the build log above." -ForegroundColor Yellow
}

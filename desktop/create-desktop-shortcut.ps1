<#
  Create the "Research Workspace" shortcut on the desktop.
  ------------------------------------------------------------------
  Usage (from the desktop folder):
      powershell -NoProfile -ExecutionPolicy Bypass -File .\create-desktop-shortcut.ps1

  Optional:
      -ExePath <abs path>       default: release\portable\ResearchWorkspace.exe
      -IcoPath <abs path>       default: build\icon.ico
      -ShortcutName <name>      default: the Chinese app name

  NOTE: This file is intentionally pure ASCII. Windows PowerShell 5.1 reads
  scripts without a BOM as ANSI, so any non-ASCII literal here would be
  mangled and break parsing. The Chinese shortcut name and description are
  therefore assembled from Unicode code points below.
#>
param(
  [string]$ExePath = "",
  [string]$IcoPath = "",
  [string]$ShortcutName = ""
)

$ErrorActionPreference = "Stop"

if (-not $ExePath) { $ExePath = Join-Path $PSScriptRoot "release\portable\ResearchWorkspace.exe" }
if (-not $IcoPath) { $IcoPath = Join-Path $PSScriptRoot "build\icon.ico" }

if (-not $ShortcutName) {
  # 0x79D1 0x7814 0x5DE5 0x4F5C 0x53F0  ->  Ke Yan Gong Zuo Tai
  $ShortcutName = -join ([char]0x79D1, [char]0x7814, [char]0x5DE5, [char]0x4F5C, [char]0x53F0)
}

# 0x4E2A 0x4EBA 0x0020 0x0041 0x0049 0x0020 0x79D1 0x7814 0x5DE5 0x7A0B 0x5DE5 0x4F5C 0x53F0
$description = -join ([char]0x4E2A, [char]0x4EBA, [char]0x0020, [char]0x0041, [char]0x0049, [char]0x0020, [char]0x79D1, [char]0x7814, [char]0x5DE5, [char]0x7A0B, [char]0x5DE5, [char]0x4F5C, [char]0x53F0)

if (-not (Test-Path -LiteralPath $ExePath)) {
  Write-Host "[x] Executable not found: $ExePath"
  Write-Host "    Run 'npm run portable' first."
  exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
if (-not (Test-Path -LiteralPath $desktop)) {
  Write-Host "[x] Desktop folder not found."
  exit 1
}

$lnkPath = Join-Path $desktop ($ShortcutName + ".lnk")
$workingDir = Split-Path -Parent $ExePath

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $ExePath
$lnk.WorkingDirectory = $workingDir
$lnk.Description = $description
$lnk.WindowStyle = 1
if (Test-Path -LiteralPath $IcoPath) {
  $lnk.IconLocation = "$IcoPath,0"
} else {
  $lnk.IconLocation = "$ExePath,0"
}
$lnk.Save()

$verify = $shell.CreateShortcut($lnkPath)
Write-Host "[ok] Desktop shortcut created."
Write-Host "     Path   : $lnkPath"
Write-Host "     Target : $($verify.TargetPath)"
Write-Host "     Icon   : $($verify.IconLocation)"

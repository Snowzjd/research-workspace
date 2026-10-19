param(
  [string]$Url = 'https://github.com/Snowzjd/research-workspace/releases/latest/download/ResearchWorkspace-win64.zip',
  [string]$DestDir = (Join-Path $env:LOCALAPPDATA 'ResearchWorkspace'),
  [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
  [long]$MinSize = 50MB,
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$zipTmp = Join-Path $env:TEMP 'ResearchWorkspace-install.zip'
$exe = Join-Path $DestDir 'ResearchWorkspace.exe'
Write-Host '== Research Workspace installer =='
Write-Host "Install to : $DestDir"
Write-Host "Shortcut   : $DesktopDir\Research Workspace.lnk"

$ok = $false
for ($i = 1; $i -le 3; $i++) {
  try {
    Write-Host "Downloading (attempt $i/3) - about 270 MB, please wait..."
    Invoke-WebRequest -Uri $Url -OutFile $zipTmp -UseBasicParsing -TimeoutSec 3600
    $ok = $true
    break
  } catch {
    Write-Host ("  attempt {0} failed: {1}" -f $i, $_.Exception.Message)
    Start-Sleep -Seconds 2
  }
}

if (-not $ok -or (Get-Item $zipTmp -ErrorAction SilentlyContinue).Length -lt $MinSize) {
  Write-Host ''
  Write-Host 'Download failed. Try again later, or download manually:'
  Write-Host "  $Url"
  Write-Host 'then unzip it anywhere and run ResearchWorkspace.exe inside.'
  exit 1
}

Write-Host ("Downloaded: {0:N1} MB" -f ((Get-Item $zipTmp).Length / 1MB))

# 解压：优先用系统自带 tar（比 Expand-Archive 快很多）
if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
  if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  tar -xf $zipTmp -C $DestDir
  if (-not (Test-Path $exe)) { throw "Unzip failed: $exe not found" }
} else {
  if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
  Expand-Archive -Path $zipTmp -DestinationPath $DestDir -Force
}
Remove-Item $zipTmp -Force -ErrorAction SilentlyContinue
Write-Host "Installed to: $DestDir"

# 桌面快捷方式：失败不影响安装本体，给出手动步骤
$lnkPath = Join-Path $DesktopDir 'Research Workspace.lnk'
try {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $DestDir
  $lnk.IconLocation = "$exe,0"
  $lnk.Save()
  Write-Host "Desktop shortcut created: $lnkPath"
} catch {
  Write-Host "Shortcut creation failed. Manual step: open $DestDir ,"
  Write-Host '  right-click ResearchWorkspace.exe -> Send to -> Desktop (create shortcut).'
}

if (-not $NoLaunch) {
  Start-Process $exe -WorkingDirectory $DestDir
  Write-Host 'Launching...'
}
Write-Host ''
Write-Host 'Done. Note: first launch may show a SmartScreen prompt -'
Write-Host '  click "More info" then "Run anyway".'
Write-Host 'After first launch, set the update source (Settings - About):'
Write-Host '  github:Snowzjd/research-workspace'

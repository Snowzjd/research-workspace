param([Parameter(Mandatory=$true)][string]$Candidate)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Candidate).ProviderPath
$exe = Join-Path $root 'ResearchWorkspace.exe'
$cmd = Join-Path $root 'start.cmd'
$build = Get-Content -LiteralPath (Join-Path $root 'BUILD-INFO.json') -Raw | ConvertFrom-Json
$versionInfo = (Get-Item -LiteralPath $exe).VersionInfo
if ($build.version -ne '4.0.0' -or $build.platform -ne 'win32' -or $build.arch -ne 'x64' -or
    $versionInfo.FileVersion -ne '4.0.0.0' -or $versionInfo.ProductVersion -ne '4.0.0') {
  throw 'Build metadata and Windows executable version must match 4.0.0'
}
$bytes = [IO.File]::ReadAllBytes($cmd)
$expected = "@echo off`r`nstart `"`" /D `"%~dp0`" `"%~dp0ResearchWorkspace.exe`"`r`n"
if (($bytes | Where-Object { $_ -gt 127 }) -or [Text.Encoding]::ASCII.GetString($bytes) -cne $expected) {
  throw 'start.cmd must be ASCII CRLF and use the portable working directory'
}
function Get-CandidateProcess {
  Get-Process -Name ResearchWorkspace -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe }
}
if (Get-CandidateProcess) { throw 'Candidate is already running' }
$began = Get-Date
$launcher = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', 'start.cmd') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  if (-not $launcher.WaitForExit(10000) -or $launcher.ExitCode -ne 0) { throw 'start.cmd failed' }
  $deadline = (Get-Date).AddSeconds(25)
  $health = $null
  $log = Join-Path $root 'portable-user-data\startup.log'
  do {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).LastWriteTime -ge $began) {
      $launchFailure = Select-String -LiteralPath $log -Pattern 'render-process-gone:.*"reason":"launch-failed"' | Select-Object -Last 1
      if ($launchFailure) { throw ('CMD launched the app, and its renderer failed. ' + $launchFailure.Line) }
    }
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17403/api/health' -TimeoutSec 2
      if ($health.windowReady -and $health.port -eq 17403) { break }
    } catch { }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if (-not (Get-CandidateProcess) -or -not $health.windowReady -or $health.version -ne '4.0.0') {
    throw 'CMD did not launch the expected version and candidate window'
  }
  $windowProcess = $null
  do {
    $windowProcess = Get-CandidateProcess | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($windowProcess) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if (-not $windowProcess) { throw 'Portable process had no visible window' }
  if ($windowProcess.MainWindowTitle -notmatch ' V4\.0\.0$') { throw 'Visible window version must be V4.0.0' }
  # Wait for the browser to close its own children.
  $null = $windowProcess.Handle
  if (-not $windowProcess.CloseMainWindow() -or -not $windowProcess.WaitForExit(8000) -or $windowProcess.ExitCode -ne 0) {
    throw 'Candidate window did not close cleanly'
  }
  if (Select-String -LiteralPath $log -Pattern 'render-process-gone:' -Quiet) {
    throw 'Candidate renderer exited unexpectedly'
  }
  "PASS start.cmd, matching executable/build/window versions 4.0.0, isolated profile, API port 17403, clean exit"
} finally {
  foreach ($candidateProcess in @(Get-CandidateProcess)) {
    Stop-Process -Id $candidateProcess.Id -ErrorAction SilentlyContinue
  }
}

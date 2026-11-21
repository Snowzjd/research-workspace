param([Parameter(Mandatory=$true)][string]$Candidate)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Candidate).ProviderPath
$exe = Join-Path $root 'ResearchWorkspace.exe'
$cmd = Join-Path $root 'start.cmd'
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
  $log = Join-Path $root 'candidate-user-data\startup.log'
  do {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).LastWriteTime -ge $began) {
      $launchFailure = Select-String -LiteralPath $log -Pattern 'render-process-gone:.*"reason":"launch-failed"' | Select-Object -Last 1
      if ($launchFailure) { throw ('CMD launched the app, and its renderer failed. ' + $launchFailure.Line) }
    }
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17400/api/health' -TimeoutSec 2
      if ($health.windowReady -and $health.port -eq 17400) { break }
    } catch { }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if (-not (Get-CandidateProcess) -or -not $health.windowReady -or $health.version -ne '4.0.0-rc.1') {
    throw 'CMD did not launch the expected version and candidate window'
  }
  $windowProcess = $null
  do {
    $windowProcess = Get-CandidateProcess | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($windowProcess) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if (-not $windowProcess) { throw 'Candidate process had no visible window' }
  # Wait for the browser to close its own children.
  $null = $windowProcess.Handle
  if (-not $windowProcess.CloseMainWindow() -or -not $windowProcess.WaitForExit(8000) -or $windowProcess.ExitCode -ne 0) {
    throw 'Candidate window did not close cleanly'
  }
  if (Select-String -LiteralPath $log -Pattern 'render-process-gone:' -Quiet) {
    throw 'Candidate renderer exited unexpectedly'
  }
  "PASS start.cmd exact bytes, candidate executable path, visible window, API port 17400, version 4.0.0-rc.1, clean exit"
} finally {
  foreach ($candidateProcess in @(Get-CandidateProcess)) {
    Stop-Process -Id $candidateProcess.Id -ErrorAction SilentlyContinue
  }
}

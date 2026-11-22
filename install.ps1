param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'ResearchWorkspace-4.0.0')
)
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) {
  throw '目标目录已存在。请指定一个尚未使用的新目录。'
}
$base = 'https://github.com/Snowzjd/research-workspace/releases/download/v4.0.0'
$name = 'ResearchWorkspace-4.0.0-Windows-x64.zip'
$cache = Join-Path ([IO.Path]::GetTempPath()) ('research-workspace-download-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $cache | Out-Null
$archive = Join-Path $cache $name
$manifest = Join-Path $cache 'SHA256SUMS.txt'
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $manifest
Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $archive
$pattern = '^([0-9a-fA-F]{64})  ' + [regex]::Escape($name) + '$'
$expected = @(Get-Content -LiteralPath $manifest | Where-Object { $_ -match $pattern })
if ($expected.Count -ne 1) { throw '正式校验文件中缺少唯一的 Windows 包校验值。' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
if ($hash -ne $expected[0].Substring(0, 64)) { throw '下载文件的 SHA-256 校验失败。' }
New-Item -ItemType Directory -Path $Destination | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $Destination
Write-Host "已解压正式版至 $Destination。双击其中的 start.cmd 启动。"

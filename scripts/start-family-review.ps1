param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$state = Join-Path $root '.guardian-review'
$null = New-Item -ItemType Directory -Path $state -Force
$node = (Get-Command node -ErrorAction Stop).Source
$firebase = Join-Path $root 'firestore\node_modules\firebase-tools\lib\bin\firebase.js'
if (!(Test-Path -LiteralPath $firebase)) { throw 'Run npm ci in firestore and gateway first.' }
$flutter = (Get-Command flutter -ErrorAction SilentlyContinue).Source
if (!$flutter) { $flutter = Join-Path $env:USERPROFILE 'develop\flutter\bin\flutter.bat' }
if (!$env:JAVA_HOME) {
  $java = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
    Where-Object Name -Like 'jdk-21*' | Sort-Object Name -Descending | Select-Object -First 1
  if ($java) { $env:JAVA_HOME = $java.FullName }
}
if (!$env:JAVA_HOME) { throw 'Java 21 or newer is required for the emulators.' }
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
function ReviewHealth {
  try { return (Invoke-RestMethod 'http://127.0.0.1:9011/review/health' -TimeoutSec 2).project -eq 'demo-guardian-family' }
  catch { return $false }
}
if (ReviewHealth) { Write-Output 'Review is already running: http://127.0.0.1:9080'; return }
$emulator = $null
$processFile = Join-Path $state 'processes.json'
if (Test-Path -LiteralPath $processFile) {
  $previous = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.emulator)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine.Contains($firebase) -and
      $process.CommandLine.Contains('firebase.review.json') -and $process.CommandLine.Contains('demo-guardian-family')) {
    $emulator = Get-Process -Id $previous.emulator -ErrorAction Stop
  }
}
foreach ($port in @(9011, 9080, 8185, 9195, 9295, 4405, 4505)) {
  if ($emulator -and $port -notin @(9011, 9080)) { continue }
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already occupied. Stop the previous review processes before restarting."
  }
}
if (!$SkipBuild) {
  Push-Location (Join-Path $root 'apps\mobile')
  try {
    & $flutter build web --target tool/family_review_main.dart --output build/family-review --dart-define=GUARDIAN_GATEWAY_URL=http://127.0.0.1:9011
    if ($LASTEXITCODE -ne 0) { throw 'Review build failed.' }
  } finally { Pop-Location }
}
$env:GCLOUD_PROJECT = 'demo-guardian-family'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8185'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9195'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9295'
if (!$emulator) {
  $emulator = Start-Process -FilePath $node -ArgumentList @(
  "`"$firebase`"", '--config', 'firebase.review.json', '--project', 'demo-guardian-family',
  'emulators:start', '--only', 'auth,firestore,storage'
) -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $state 'emulators.log') -RedirectStandardError (Join-Path $state 'emulators-error.log')
}
@{ emulator = $emulator.Id } | ConvertTo-Json | Set-Content (Join-Path $state 'processes.json')
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  if ($emulator.HasExited) { throw "Emulators stopped. See $state\emulators-error.log" }
  try {
    $inventory = Invoke-RestMethod 'http://127.0.0.1:4405/emulators' -TimeoutSec 1
    if ($inventory.auth -and $inventory.firestore -and $inventory.storage) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (!$ready) { throw "Emulators did not become ready. See $state\emulators.log" }
$serverPath = Join-Path $root 'gateway\scripts\family-review-server.js'
$server = Start-Process -FilePath $node -ArgumentList "`"$serverPath`"" -WorkingDirectory $root `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'server.log') `
  -RedirectStandardError (Join-Path $state 'server-error.log')
@{ emulator = $emulator.Id; server = $server.Id } | ConvertTo-Json | Set-Content (Join-Path $state 'processes.json')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if (ReviewHealth) { Write-Output 'Review ready: http://127.0.0.1:9080'; return }
  if ($server.HasExited) { throw "Review server stopped. See $state\server-error.log" }
  Start-Sleep -Seconds 1
}
throw "Review server did not become ready. See $state\server-error.log"

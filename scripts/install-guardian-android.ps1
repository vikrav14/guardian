# Builds and installs the current Guardian app without replacing it with a stale
# checkout. Keep private Android config and Maps keys out of the release record.
[CmdletBinding()]
param(
    [string]$Flutter = 'flutter',
    [string]$Adb = 'adb',
    [string]$DeviceId = '',
    [string]$ConfigPath = '',
    [switch]$BuildOnly,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repoRoot 'apps/mobile'
if (-not $ConfigPath) { $ConfigPath = Join-Path $appRoot 'android-config.json' }

function Invoke-GuardianNative {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE). Android installation stopped." }
}

Push-Location $repoRoot
try {
    Invoke-GuardianNative git @('fetch', 'origin', 'main')
    & git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0) {
        throw 'This checkout is missing commits from current main. Bring main into this branch before building or installing Guardian.'
    }
    $head = (Invoke-GuardianNative git @('rev-parse', 'HEAD')).Trim()
    $main = (Invoke-GuardianNative git @('rev-parse', 'origin/main')).Trim()
    if ($ValidateOnly) { Write-Host "Android source base verified: $head"; return }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Private Android configuration is missing.' }
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($key in @('FIREBASE_ANDROID_APP_ID', 'FIREBASE_ANDROID_API_KEY', 'GUARDIAN_GATEWAY_URL')) {
        if ([string]::IsNullOrWhiteSpace([string]$config.$key)) { throw "Private Android configuration is missing $key." }
    }
    $configResolved = (Resolve-Path -LiteralPath $ConfigPath).Path
    $deviceArgs = @()
    if ($DeviceId) { $deviceArgs = @('-s', $DeviceId) }
    if (-not $BuildOnly) {
        $state = (Invoke-GuardianNative $Adb ($deviceArgs + @('get-state'))).Trim()
        if ($state -ne 'device') { throw 'Select one connected and authorised Android device.' }
    }

    # New builds sort above the old versionCode=1 APKs. Plain adb install -r
    # will reject those older APKs instead of silently undoing deployed fixes.
    $buildNumber = [long][Math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() / 60)
    $dirty = [bool](Invoke-GuardianNative git @('status', '--porcelain', '--untracked-files=normal'))
    Push-Location $appRoot
    try {
        Invoke-GuardianNative $Flutter @('build', 'apk', '--debug', '--no-pub', "--build-number=$buildNumber", "--dart-define-from-file=$configResolved")
    } finally { Pop-Location }

    # Main may advance during a long build. Recheck before installing.
    Invoke-GuardianNative git @('fetch', 'origin', 'main')
    & git merge-base --is-ancestor origin/main HEAD
    if ($LASTEXITCODE -ne 0 -or (Invoke-GuardianNative git @('rev-parse', 'HEAD')).Trim() -ne $head) {
        throw 'Source base changed while building. Rebuild against current main before installing.'
    }
    $main = (Invoke-GuardianNative git @('rev-parse', 'origin/main')).Trim()
    $apk = Join-Path $appRoot 'build/app/outputs/flutter-apk/app-debug.apk'
    $record = [ordered]@{
        builtAt = [DateTimeOffset]::UtcNow.ToString('o'); sourceCommit = $head
        mainCommit = $main; hasUncommittedChanges = $dirty; versionCode = $buildNumber
        apkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
        installed = $false
    }
    $recordPath = Join-Path $appRoot 'build/guardian-android-release.json'
    $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
    if (-not $BuildOnly) {
        # No uninstall/data wipe and no -d version-downgrade override.
        Invoke-GuardianNative $Adb ($deviceArgs + @('install', '-r', $apk))
        $record.installed = $true
        $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8
    }
    Write-Host "Guardian Android build $buildNumber completed. Record: $recordPath"
} finally { Pop-Location }

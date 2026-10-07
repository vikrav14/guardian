# Isolated integration tests. Native commands are mocked; no device is changed.
$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('guardian-android-test-' + [Guid]::NewGuid())
$null = New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'), (Join-Path $fixture 'apps/mobile/build/app/outputs/flutter-apk') -Force
Copy-Item (Join-Path $PSScriptRoot 'install-guardian-android.ps1') (Join-Path $fixture 'scripts')
Set-Content (Join-Path $fixture 'apps/mobile/android-config.json') '{"FIREBASE_ANDROID_APP_ID":"test","FIREBASE_ANDROID_API_KEY":"test","GUARDIAN_GATEWAY_URL":"https://example.test"}'
$testState = @{ stale = $false; fetchFailure = $false; buildFailure = $false; installs = 0; builds = 0; afterBuildStale = $false; failInstall = $false }
function Assert-True($value, $message) { if (-not $value) { throw "FAILED: $message" } }
function git {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'fetch' -and $testState.fetchFailure) { $global:LASTEXITCODE = 1 }
    if ($args[0] -eq 'merge-base' -and ($testState.stale -or ($testState.afterBuildStale -and $testState.builds -gt 0))) { $global:LASTEXITCODE = 1 }
    if ($args[0] -eq 'rev-parse') { 'abc123' }
}
function flutter {
    $global:LASTEXITCODE = 0; $testState.builds++
    Assert-True ($args -match '^--build-number=\d+$') 'Monotonic Android version missing'
    if ($testState.buildFailure) { $global:LASTEXITCODE = 1; return }
    Set-Content (Join-Path $fixture 'apps/mobile/build/app/outputs/flutter-apk/app-debug.apk') 'synthetic APK'
}
function adb {
    $global:LASTEXITCODE = 0
    if ($args -contains 'get-state') { 'device'; return }
    Assert-True ($args -contains 'install') 'Unexpected adb operation'
    Assert-True ($args -notcontains '-d' -and $args -notcontains 'uninstall') 'Downgrade/data wipe forbidden'
    $testState.installs++
    if ($testState.failInstall) { $global:LASTEXITCODE = 1 }
}
function Expect-Failure($field) {
    foreach ($key in @('stale', 'fetchFailure', 'buildFailure', 'afterBuildStale', 'failInstall')) { $testState[$key] = $false }
    $testState.builds = 0; $testState.installs = 0; $testState[$field] = $true
    $failed = $false
    try { & (Join-Path $fixture 'scripts/install-guardian-android.ps1') } catch { $failed = $true }
    Assert-True $failed "Expected failure for $field"
    if ($field -ne 'failInstall') { Assert-True ($testState.installs -eq 0) "Install proceeded after $field" }
}
try {
    foreach ($failure in @('stale', 'fetchFailure', 'buildFailure', 'afterBuildStale', 'failInstall')) { Expect-Failure $failure }
    $testState.failInstall = $false; $testState.builds = 0; $testState.installs = 0
    & (Join-Path $fixture 'scripts/install-guardian-android.ps1')
    Assert-True ($testState.installs -eq 1) 'Current build was not installed once'
    $record = Get-Content (Join-Path $fixture 'apps/mobile/build/guardian-android-release.json') -Raw | ConvertFrom-Json
    Assert-True ($record.installed -and $record.versionCode -gt 1 -and $record.sourceCommit -eq 'abc123') 'Release provenance missing'
    Write-Host 'Android install safeguards passed (6 scenarios).'
} finally {
    $resolvedFixture = (Resolve-Path -LiteralPath $fixture).Path
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture path; refusing cleanup.' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}

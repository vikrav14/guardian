# Publishes the existing Flutter app only. No database/storage rules or gateway
# flags are deployed. Requires the developer's local, gitignored Maps web key.
[CmdletBinding()]
param(
    [string]$GatewayUrl = '',
    [switch]$EnableSafetySnapshots
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repoRoot 'apps/mobile'
$projectId = 'guardian-fbadd'
$appUrl = "https://$projectId.web.app"
. (Join-Path $PSScriptRoot 'guardian-hosting-tools.ps1')

function Invoke-CheckedNative {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed (exit $LASTEXITCODE). Deployment stopped."
    }
}

foreach ($command in @('flutter')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is not available. Use the terminal where Flutter normally works."
    }
}

$config = Get-Content -LiteralPath (Join-Path $repoRoot 'firebase.json') -Raw | ConvertFrom-Json
if ($config.hosting.site -ne $projectId -or $config.hosting.public -ne 'apps/mobile/build/web') {
    throw 'The Hosting target does not match Guardian. Nothing was deployed.'
}
$mapsPath = Join-Path $appRoot 'web/maps_key.js'
if (-not (Test-Path -LiteralPath $mapsPath)) {
    throw 'The local web/maps_key.js is missing. Run this from your working Guardian checkout.'
}
$mapsText = Get-Content -LiteralPath $mapsPath -Raw
if ($mapsText -notmatch '(?m)^\s*window\.GOOGLE_MAPS_API_KEY\s*=\s*[''"]AIza[A-Za-z0-9_-]{30,}[''"]') {
    throw 'The local Maps web key is not configured. Nothing was deployed.'
}
Remove-Variable mapsText

if (-not $GatewayUrl) {
    $endpoints = (Invoke-RestMethod 'http://127.0.0.1:4040/api/endpoints' -TimeoutSec 10).endpoints
    $candidates = @($endpoints | Where-Object {
        $_.url -like 'https://*' -and
        $_.upstream.url -match '^https?://(?:localhost|127\.0\.0\.1):9001/?$'
    })
    if ($candidates.Count -ne 1) {
        throw 'Start the HTTPS ngrok tunnel to port 9001, or pass -GatewayUrl https://YOUR-GATEWAY.'
    }
    $GatewayUrl = $candidates[0].url
}
$gateway = $null
if (-not [Uri]::TryCreate($GatewayUrl, [UriKind]::Absolute, [ref]$gateway) -or
    $gateway.Scheme -ne 'https' -or $gateway.IsLoopback -or
    $gateway.HostNameType -ne [UriHostNameType]::Dns -or
    $gateway.DnsSafeHost.EndsWith('.localhost') -or
    $gateway.UserInfo -or $gateway.Query -or $gateway.Fragment -or
    $gateway.AbsolutePath -ne '/') {
    throw 'GatewayUrl must be a public HTTPS origin, without credentials, path, query or fragment.'
}
$GatewayUrl = $gateway.GetLeftPart([UriPartial]::Authority)
$health = Invoke-RestMethod "$GatewayUrl/health" -TimeoutSec 20 -Headers @{ 'ngrok-skip-browser-warning' = '1' }
if ($health.ok -ne $true -or $health.service -ne 'guardian-gateway-http') {
    throw 'The HTTPS address did not return the Guardian gateway health response. Nothing was deployed.'
}

Push-Location $repoRoot
try {
    $firebase = Get-GuardianFirebaseTools
    Write-Host 'Checking Firebase access. Use the Google account that manages Guardian if sign-in opens.'
    Invoke-GuardianFirebase $firebase @('login')
    Invoke-GuardianFirebase $firebase @('hosting:sites:list', '--project', $projectId, '--non-interactive')

    Push-Location $appRoot
    try {
        # Clean prevents an obsolete build being published if compilation fails.
        Invoke-CheckedNative 'flutter' @('clean')
        Invoke-CheckedNative 'flutter' @('pub', 'get', '--enforce-lockfile')
        Invoke-CheckedNative 'flutter' @('build', 'web', '--release', '--no-pub',
            "--dart-define=GUARDIAN_GATEWAY_URL=$GatewayUrl",
            "--dart-define=GUARDIAN_SAFETY_SNAPSHOTS_ENABLED=$($EnableSafetySnapshots.IsPresent.ToString().ToLowerInvariant())")
    } finally {
        Pop-Location
    }

    $buildRoot = Join-Path $appRoot 'build/web'
    foreach ($required in @('index.html', 'main.dart.js', 'flutter_bootstrap.js', 'maps_key.js', 'firebase-messaging-sw.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $buildRoot $required))) {
            throw "The web build is incomplete ($required missing). Nothing was deployed."
        }
    }
    $releaseId = [Guid]::NewGuid().ToString()
    $release = @{ releaseId = $releaseId; builtAt = [DateTime]::UtcNow.ToString('o'); gatewayUrl = $GatewayUrl }
    $release | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $buildRoot 'guardian-release.json') -Encoding UTF8
    Invoke-GuardianFirebase $firebase @('deploy', '--only', 'hosting',
        '--project', $projectId, '--config', (Join-Path $repoRoot 'firebase.json'), '--non-interactive')

    $published = Invoke-RestMethod "$appUrl/guardian-release.json?release=$releaseId" -TimeoutSec 30
    if ($published.releaseId -ne $releaseId) {
        throw 'Firebase reported deployment success, but the new release could not be verified. Share this message before retrying.'
    }
    Write-Host "Guardian app published and verified: $appUrl"
    Write-Host "Photo template setting: INCIDENT_PHOTOS_APP_URL=$appUrl"
    Write-Host 'Keep the gateway and ngrok running. Open this address on your phone and sign in.'
    Write-Host 'If Maps reports a referrer error, allow this app address on your existing Maps web key; keep its restrictions enabled.'
} finally {
    Pop-Location
}

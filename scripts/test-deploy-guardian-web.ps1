# Run under Windows PowerShell, the deployment script's target shell.
# All native/network commands are replaced: these tests never publish anything.
$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('guardian-hosting-test-' + [Guid]::NewGuid())
$sourceRoot = Split-Path -Parent $PSScriptRoot
$null = New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'), (Join-Path $fixture 'apps/mobile/web') -Force
Copy-Item (Join-Path $PSScriptRoot 'deploy-guardian-web.ps1') (Join-Path $fixture 'scripts')
Copy-Item (Join-Path $sourceRoot 'firebase.json') $fixture
Set-Content (Join-Path $fixture 'apps/mobile/web/maps_key.js') "window.GOOGLE_MAPS_API_KEY = 'AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';"
$script:commands = @()
$script:failure = ''
$script:wrongHealth = $false
$script:wrongRelease = $false
$script:ambiguousEndpoint = $false

function Assert-True($condition, $message) {
    if (-not $condition) { throw "FAILED: $message" }
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $Headers)
    if ($Uri -eq 'http://127.0.0.1:4040/api/endpoints') {
        $endpoint = @{ url = 'https://gateway.example'; upstream = @{ url = 'http://localhost:9001' } }
        if ($script:ambiguousEndpoint) { return @{ endpoints = @($endpoint, $endpoint) } }
        return @{ endpoints = @($endpoint) }
    }
    if ($Uri -eq 'https://gateway.example/health') {
        Assert-True ($Headers['ngrok-skip-browser-warning'] -eq '1') 'ngrok warning bypass missing'
        return @{ ok = -not $script:wrongHealth; service = 'guardian-gateway-http' }
    }
    if ($Uri -like 'https://guardian-fbadd.web.app/guardian-release.json?release=*') {
        if ($script:wrongRelease) { return @{ releaseId = 'old-release' } }
        return (Get-Content (Join-Path $fixture 'apps/mobile/build/web/guardian-release.json') -Raw | ConvertFrom-Json)
    }
    throw "Unexpected network request: $Uri"
}
function npx {
    $script:commands += ,(@('npx') + $args)
    $global:LASTEXITCODE = 0
}
function flutter {
    $script:commands += ,(@('flutter') + $args)
    $global:LASTEXITCODE = 0
    if ($script:failure -and $args[0] -eq $script:failure) {
        $global:LASTEXITCODE = 1
        return
    }
    if ($args[0] -eq 'build') {
        $output = Join-Path $fixture 'apps/mobile/build/web'
        $null = New-Item -ItemType Directory -Path $output -Force
        foreach ($name in @('index.html', 'main.dart.js', 'flutter_bootstrap.js', 'maps_key.js', 'firebase-messaging-sw.js')) {
            Set-Content (Join-Path $output $name) 'synthetic build fixture'
        }
    }
}
function Run-Deployment {
    param([string]$Url = 'https://gateway.example', [switch]$Discover)
    $script:commands = @()
    if ($Discover) { & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') }
    else { & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') -GatewayUrl $Url }
}
function Expect-Stopped {
    param([scriptblock]$Action, [string]$Message)
    $caught = $false
    try { & $Action } catch { $caught = $true }
    Assert-True $caught $Message
    $deploys = @($script:commands | Where-Object { $_ -contains 'deploy' })
    Assert-True ($deploys.Count -eq 0) 'Failure must prevent publication'
}

try {
    Run-Deployment -Discover
    $deploys = @($script:commands | Where-Object { $_ -contains 'deploy' })
    Assert-True ($deploys.Count -eq 1) 'Exactly one deployment expected'
    $deployment = $deploys[0]
    Assert-True (($deployment -join ' ') -match '--only hosting --project guardian-fbadd --config') 'Deployment scope must stay hosting-only and target Guardian'
    $build = @($script:commands | Where-Object { $_[0] -eq 'flutter' -and $_[1] -eq 'build' })[0]
    Assert-True ($build -contains '--dart-define=GUARDIAN_GATEWAY_URL=https://gateway.example') 'Current gateway must reach Flutter build'
    Assert-True ($build -contains '--dart-define=GUARDIAN_SAFETY_SNAPSHOTS_ENABLED=false') 'Manual capture UI must remain opt-in'
    Assert-True ($build -contains '--no-pub') 'Build must use the locked dependency restore'

    foreach ($stage in @('clean', 'pub', 'build')) {
        $script:failure = $stage
        Expect-Stopped { Run-Deployment } "Failed $stage must stop"
    }
    $script:failure = ''
    $script:wrongHealth = $true
    Expect-Stopped { Run-Deployment } 'Wrong health service must stop'
    $script:wrongHealth = $false
    $script:ambiguousEndpoint = $true
    Expect-Stopped { Run-Deployment -Discover } 'Ambiguous gateway must stop'
    $script:ambiguousEndpoint = $false
    foreach ($badUrl in @('http://gateway.example', 'https://localhost', 'https://gateway.example/?token=secret', 'https://user:secret@gateway.example', 'https://gateway.example/path')) {
        Expect-Stopped { Run-Deployment -Url $badUrl } 'Unsafe gateway URL must stop'
    }
    $script:wrongRelease = $true
    $caught = $false
    try { Run-Deployment } catch { $caught = $_.Exception.Message -like '*new release could not be verified*' }
    Assert-True $caught 'Old release must not be reported as published successfully'
    Write-Host 'Hosting deployment checks passed (no live deployments or network requests).'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}

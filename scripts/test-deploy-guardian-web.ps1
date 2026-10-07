# Run under Windows PowerShell, the deployment script's target shell.
# All native/network commands are replaced: these tests never publish anything.
$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('guardian-hosting-test-' + [Guid]::NewGuid())
$sourceRoot = Split-Path -Parent $PSScriptRoot
$null = New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'), (Join-Path $fixture 'apps/mobile/web') -Force
Copy-Item (Join-Path $PSScriptRoot 'deploy-guardian-web.ps1') (Join-Path $fixture 'scripts')
Copy-Item (Join-Path $PSScriptRoot 'guardian-hosting-tools.ps1') (Join-Path $fixture 'scripts')
# Substitute tool acquisition, but retain the real Firebase invocation/exit guard.
Add-Content (Join-Path $fixture 'scripts/guardian-hosting-tools.ps1') @'

function Get-GuardianFirebaseTools {
    if ($testState.setupFailure) { throw 'Synthetic deployment tool setup failure' }
    return @{ Node = 'guardian-test-node'; Cli = 'isolated/firebase.js' }
}
'@
Copy-Item (Join-Path $sourceRoot 'firebase.json') $fixture
Set-Content (Join-Path $fixture 'apps/mobile/web/maps_key.js') "window.GOOGLE_MAPS_API_KEY = 'AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';"
# A shared object survives the child script scope used to execute deployment.
$testState = @{
    commands = New-Object 'System.Collections.Generic.List[object]'
    failure = ''; wrongHealth = $false; wrongRelease = $false; ambiguousEndpoint = $false
    firebaseFailure = ''; setupFailure = $false; releaseChecks = 0
    releaseBom = $false; invalidRelease = $false; wrongGateway = $false
}

function Assert-True($condition, $message) {
    if (-not $condition) { throw "FAILED: $message" }
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $Headers)
    if ($Uri -eq 'http://127.0.0.1:4040/api/endpoints') {
        $endpoint = @{ url = 'https://gateway.example'; upstream = @{ url = 'http://localhost:9001' } }
        if ($testState.ambiguousEndpoint) { return @{ endpoints = @($endpoint, $endpoint) } }
        return @{ endpoints = @($endpoint) }
    }
    if ($Uri -eq 'https://gateway.example/health') {
        Assert-True ($Headers['ngrok-skip-browser-warning'] -eq '1') 'ngrok warning bypass missing'
        return @{ ok = -not $testState.wrongHealth; service = 'guardian-gateway-http' }
    }
    throw "Unexpected network request: $Uri"
}
function Invoke-WebRequest {
    param($Uri, $TimeoutSec, $Headers, [switch]$UseBasicParsing)
    Assert-True ($Uri -like 'https://guardian-fbadd.web.app/guardian-release.json?release=*') 'Unexpected release URL'
    Assert-True $UseBasicParsing 'Windows verification must not require Internet Explorer'
    $testState.releaseChecks++
    $release = Get-Content (Join-Path $fixture 'apps/mobile/build/web/guardian-release.json') -Raw | ConvertFrom-Json
    if ($testState.wrongRelease) { $release.releaseId = 'old-release' }
    if ($testState.wrongGateway) { $release.gatewayUrl = 'https://old-gateway.example' }
    $content = $release | ConvertTo-Json
    if ($testState.invalidRelease) { $content = '<html>SPA fallback, not a release marker</html>' }
    [byte[]]$bytes = [Text.Encoding]::UTF8.GetBytes($content)
    if ($testState.releaseBom) { $bytes = [byte[]]@(239, 187, 191) + $bytes }
    return @{ RawContentStream = [IO.MemoryStream]::new($bytes) }
}
function npx { throw 'System npx must not be used for deployment' }
function node { throw 'System Node must not be used for deployment' }
function guardian-test-node {
    Assert-True ($args[0] -eq 'isolated/firebase.js') 'Firebase must use the isolated JS entry point'
    $testState.commands.Add([pscustomobject]@{ command = 'firebase'; arguments = @($args | Select-Object -Skip 1) })
    $global:LASTEXITCODE = 0
    if ($testState.firebaseFailure -eq $args[1]) { $global:LASTEXITCODE = -1073740791 }
}
function flutter {
    $testState.commands.Add([pscustomobject]@{ command = 'flutter'; arguments = @($args) })
    $global:LASTEXITCODE = 0
    if ($testState.failure -and $args[0] -eq $testState.failure) {
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
    $testState.commands.Clear()
    $testState.releaseChecks = 0
    if ($Discover) { & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') }
    else { & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') -GatewayUrl $Url }
}
function Expect-Stopped {
    param([scriptblock]$Action, [string]$Message)
    $caught = $false
    try { & $Action } catch { $caught = $true }
    Assert-True $caught $Message
    $deploys = @($testState.commands | Where-Object { $_.arguments -contains 'deploy' })
    Assert-True ($deploys.Count -eq 0) 'Failure must prevent publication'
}

try {
    Run-Deployment -Discover
    $deploys = @($testState.commands | Where-Object { $_.arguments -contains 'deploy' })
    Assert-True ($deploys.Count -eq 1) 'Exactly one deployment expected'
    $deployment = $deploys[0].arguments
    Assert-True (($deployment -join ' ') -match '--only hosting --project guardian-fbadd --config') 'Deployment scope must stay hosting-only and target Guardian'
    $build = @($testState.commands | Where-Object { $_.command -eq 'flutter' -and $_.arguments[0] -eq 'build' })[0].arguments
    Assert-True ($build -contains '--dart-define=GUARDIAN_GATEWAY_URL=https://gateway.example') 'Current gateway must reach Flutter build'
    Assert-True ($build -contains '--dart-define=GUARDIAN_SAFETY_SNAPSHOTS_ENABLED=false') 'Manual capture UI must remain opt-in'
    Assert-True ($build -contains '--no-pub') 'Build must use the locked dependency restore'
    $releasePath = Join-Path $fixture 'apps/mobile/build/web/guardian-release.json'
    $bytes = [IO.File]::ReadAllBytes($releasePath)
    Assert-True ($bytes[0] -eq 123) 'New JSON release markers must begin with {, without a UTF-8 BOM'

    # Real byte streams exercise the encoding boundary previously hidden by mocks.
    $testState.releaseBom = $true
    Run-Deployment
    $beforeVerification = [IO.File]::ReadAllText($releasePath)
    $testState.commands.Clear()
    & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') -VerifyOnly
    Assert-True ($testState.commands.Count -eq 0) 'Read-only verification must not build, log in, or deploy'
    Assert-True ([IO.File]::ReadAllText($releasePath) -eq $beforeVerification) 'Read-only verification must preserve the local release'
    foreach ($problem in @('wrongRelease', 'wrongGateway', 'invalidRelease')) {
        $testState[$problem] = $true
        $caught = $false
        try { & (Join-Path $fixture 'scripts/deploy-guardian-web.ps1') -VerifyOnly } catch { $caught = $true }
        Assert-True $caught "Verification must reject $problem even with a BOM"
        $testState[$problem] = $false
    }
    $testState.releaseBom = $false

    $testState.setupFailure = $true
    Expect-Stopped { Run-Deployment } 'Tool setup failure must stop'
    $testState.setupFailure = $false
    foreach ($stage in @('login', 'hosting:sites:list')) {
        $testState.firebaseFailure = $stage
        Expect-Stopped { Run-Deployment } "Firebase $stage shutdown crash must stop"
        Assert-True (@($testState.commands | Where-Object { $_.command -eq 'flutter' }).Count -eq 0) 'Failed Firebase preflight must prevent the build'
    }
    $testState.firebaseFailure = 'deploy'
    $caught = $false
    try { Run-Deployment } catch { $caught = $_.Exception.Message -like '*exit -1073740791*' }
    Assert-True $caught 'A shutdown crash after deployment must not be treated as success'
    Assert-True ($testState.releaseChecks -eq 0) 'Failed deployment must not reach success verification'
    $testState.firebaseFailure = ''

    foreach ($stage in @('clean', 'pub', 'build')) {
        $testState.failure = $stage
        Expect-Stopped { Run-Deployment } "Failed $stage must stop"
    }
    $testState.failure = ''
    $testState.wrongHealth = $true
    Expect-Stopped { Run-Deployment } 'Wrong health service must stop'
    $testState.wrongHealth = $false
    $testState.ambiguousEndpoint = $true
    Expect-Stopped { Run-Deployment -Discover } 'Ambiguous gateway must stop'
    $testState.ambiguousEndpoint = $false
    foreach ($badUrl in @('http://gateway.example', 'https://localhost', 'https://gateway.example/?token=secret', 'https://user:secret@gateway.example', 'https://gateway.example/path')) {
        Expect-Stopped { Run-Deployment -Url $badUrl } 'Unsafe gateway URL must stop'
    }
    $testState.wrongRelease = $true
    $caught = $false
    try { Run-Deployment } catch { $caught = $_.Exception.Message -like '*new release could not be verified*' }
    Assert-True $caught 'Old release must not be reported as published successfully'
    Write-Host 'Hosting deployment checks passed (no live deployments or network requests).'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}

# Deployment-only tools. No global installs, PATH changes, or gateway dependency changes.
# Node 24.20+ contains the Windows libuv shutdown fix (nodejs/node#61999).
# Hashes: https://nodejs.org/en/blog/release/v24.21.0 (official release SHASUMS).
function Get-GuardianFirebaseTools {
    param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'Guardian/hosting-tools'))
    $ErrorActionPreference = 'Stop'
    if ($env:OS -ne 'Windows_NT') { throw 'This deployment helper requires Windows.' }
    $nodeVersion = '24.21.0'
    $firebaseVersion = '15.27.0'
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    switch ($architecture) {
        'AMD64' {
            $arch = 'x64'
            $zipHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
            $exeHash = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
        }
        'ARM64' {
            $arch = 'arm64'
            $zipHash = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'
            $exeHash = 'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7'
        }
        default { throw 'Guardian Hosting requires 64-bit Windows (x64 or ARM64).' }
    }
    $null = New-Item -ItemType Directory -Path $CacheRoot -Force
    $runtimeName = "node-v$nodeVersion-win-$arch"
    $runtimeRoot = Join-Path $CacheRoot $runtimeName
    $nodePath = Join-Path $runtimeRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $runtimeRoot)) {
        Write-Host "Downloading deployment-only Node $nodeVersion..."
        $stage = Join-Path $CacheRoot ('download-' + [Guid]::NewGuid())
        $null = New-Item -ItemType Directory -Path $stage
        try {
            $archive = Join-Path $stage 'node.zip'
            Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/$runtimeName.zip" -OutFile $archive -UseBasicParsing -TimeoutSec 180
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $zipHash) {
                throw 'Deployment Node download checksum mismatch. Nothing was executed.'
            }
            Expand-Archive -LiteralPath $archive -DestinationPath $stage
            Move-Item -LiteralPath (Join-Path $stage $runtimeName) -Destination $runtimeRoot
        } finally { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
    if (-not (Test-Path -LiteralPath $nodePath) -or
        (Get-FileHash -LiteralPath $nodePath -Algorithm SHA256).Hash -ne $exeHash) {
        throw "Deployment runtime verification failed. Remove only '$runtimeRoot' and retry."
    }
    $actualNodeVersion = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne "v$nodeVersion") {
        throw 'The isolated deployment Node runtime failed its startup check.'
    }
    $cliRoot = Join-Path $CacheRoot "firebase-$firebaseVersion-node-$nodeVersion-$arch"
    $cliRelativePath = 'node_modules/firebase-tools/lib/bin/firebase.js'
    if (-not (Test-Path -LiteralPath $cliRoot)) {
        Write-Host "Installing deployment-only Firebase CLI $firebaseVersion..."
        $stage = Join-Path $CacheRoot ('firebase-install-' + [Guid]::NewGuid())
        $null = New-Item -ItemType Directory -Path $stage
        try {
            # Invoke npm's JS entry point with the verified runtime. Ignore lifecycle
            # scripts: static Hosting does not need optional native/emulator builds.
            $npmPath = Join-Path $runtimeRoot 'node_modules/npm/bin/npm-cli.js'
            & $nodePath $npmPath install --prefix $stage --ignore-scripts --no-audit --no-fund --save-exact "firebase-tools@$firebaseVersion" | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "Firebase CLI installation failed (exit $LASTEXITCODE)." }
            if (-not (Test-Path -LiteralPath (Join-Path $stage $cliRelativePath))) {
                throw 'Firebase CLI installation is incomplete.'
            }
            Move-Item -LiteralPath $stage -Destination $cliRoot
        } finally {
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        }
    }
    $cliPath = Join-Path $cliRoot $cliRelativePath
    $package = Get-Content -LiteralPath (Join-Path $cliRoot 'node_modules/firebase-tools/package.json') -Raw | ConvertFrom-Json
    if ($package.version -ne $firebaseVersion -or -not (Test-Path -LiteralPath $cliPath)) {
        throw "Deployment Firebase CLI verification failed. Remove only '$cliRoot' and retry."
    }
    Write-Host "Deployment tools ready: Node $nodeVersion; Firebase CLI $firebaseVersion."
    return @{ Node = $nodePath; Cli = $cliPath }
}

function Invoke-GuardianFirebase {
    param([hashtable]$Tools, [string[]]$Arguments)
    & $Tools.Node $Tools.Cli @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Firebase $($Arguments[0]) failed (exit $LASTEXITCODE). Deployment stopped."
    }
}

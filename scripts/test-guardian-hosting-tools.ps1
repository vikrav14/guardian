# Real Windows runtime/CLI smoke test. No login, project access, or publication.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'guardian-hosting-tools.ps1')
$cache = Join-Path ([IO.Path]::GetTempPath()) ('guardian tools smoke ' + [Guid]::NewGuid())
$corruptCache = Join-Path ([IO.Path]::GetTempPath()) ('guardian corrupt tools ' + [Guid]::NewGuid())
$pathBefore = $env:PATH
try {
    $tools = Get-GuardianFirebaseTools -CacheRoot $cache
    $version = Invoke-GuardianFirebase $tools @('--version')
    if ($version -ne '15.27.0') { throw 'Unexpected Firebase CLI version.' }
    Invoke-GuardianFirebase $tools @('--help') | Out-Null
    Invoke-GuardianFirebase $tools @('login:list', '--non-interactive', '--json') | Out-Null
    # A second call must work from the verified cache, including paths with spaces.
    $cached = Get-GuardianFirebaseTools -CacheRoot $cache
    if ($cached.Node -ne $tools.Node -or $cached.Cli -ne $tools.Cli) { throw 'Cache reuse failed.' }
    if ($env:PATH -ne $pathBefore) { throw 'Tool setup changed PATH.' }
    # Never overwrite an executable just used by the CLI: a child process can
    # still hold it open on Windows. A separate existing cache exercises the
    # same checksum rejection before any version check or executable launch.
    $runtimeName = Split-Path -Leaf (Split-Path -Parent $tools.Node)
    $corruptRuntime = Join-Path $corruptCache $runtimeName
    $null = New-Item -ItemType Directory -Path $corruptRuntime -Force
    Set-Content -LiteralPath (Join-Path $corruptRuntime 'node.exe') -Value 'corrupt synthetic runtime'
    $caught = $false
    try { Get-GuardianFirebaseTools -CacheRoot $corruptCache | Out-Null }
    catch { $caught = $_.Exception.Message -like '*runtime verification failed*' }
    if (-not $caught) { throw 'Corrupt cached runtime was not rejected.' }
    Write-Host 'Real Windows Firebase CLI startup, shutdown, cache and checksum checks passed.'
} finally {
    foreach ($testCache in @($corruptCache, $cache)) {
        # Allow only a bounded wait for this test's private runtime file locks.
        # Cleanup still fails explicitly if the files remain locked.
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while (Test-Path -LiteralPath $testCache) {
            try { Remove-Item -LiteralPath $testCache -Recurse -Force }
            catch {
                if ([DateTime]::UtcNow -ge $deadline) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    }
}

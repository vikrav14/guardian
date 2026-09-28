# Real Windows runtime/CLI smoke test. No login, project access, or publication.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'guardian-hosting-tools.ps1')
$cache = Join-Path ([IO.Path]::GetTempPath()) ('guardian tools smoke ' + [Guid]::NewGuid())
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
    # A corrupt cached runtime must never be executed or silently accepted.
    Set-Content -LiteralPath $tools.Node -Value 'corrupt synthetic runtime'
    $caught = $false
    try { Get-GuardianFirebaseTools -CacheRoot $cache | Out-Null }
    catch { $caught = $_.Exception.Message -like '*runtime verification failed*' }
    if (-not $caught) { throw 'Corrupt cached runtime was not rejected.' }
    Write-Host 'Real Windows Firebase CLI startup, shutdown, cache and checksum checks passed.'
} finally {
    if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
}

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{10}$')]
    [string]$ProtocolId,
    [ValidateSet('anytracking', 'guardian')]
    [string]$Backend = 'anytracking',
    [ValidateRange(1, 90)]
    [int]$Minutes = 20
)

$ErrorActionPreference = 'Stop'

function Test-WifiComparisonTcp {
    param([Uri]$Address)
    $client = New-Object System.Net.Sockets.TcpClient
    $pending = $null
    try {
        $pending = $client.BeginConnect($Address.Host, $Address.Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(5000)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch {
        return $false
    } finally {
        if ($pending) { $pending.AsyncWaitHandle.Close() }
        $client.Close()
    }
}

function Get-WifiComparisonEndpoint {
    param($Endpoints, [int]$Port)
    $targetPattern = '^(?:(?:tcp|http)://)?(?:localhost|127\.0\.0\.1):' + $Port + '/?$'
    $candidateEndpoints = @($Endpoints | Where-Object {
        $_.url -like 'tcp://*' -and $_.upstream.url -match $targetPattern
    })
    if ($candidateEndpoints.Count -ne 1) {
        throw "Expected exactly one ngrok TCP endpoint targeting loopback port $Port. Share the endpoint list."
    }
    $address = [Uri]$candidateEndpoints[0].url
    if ($address.Scheme -ne 'tcp' -or $address.Port -lt 1 -or
        $address.UserInfo -or $address.Query -or $address.Fragment -or
        ($address.AbsolutePath -and $address.AbsolutePath -ne '/')) {
        throw 'Unexpected tunnel URL. Stop before changing watch routing.'
    }
    return $address
}

$recorder = Join-Path $PSScriptRoot '..\gateway\scripts\capture-wifi-session.js'
if (-not (Test-Path -LiteralPath $recorder -PathType Leaf)) { throw 'Wi-Fi recorder is missing.' }
$null = Get-Command node -ErrorAction Stop
if (-not @(Get-NetTCPConnection -State Listen -LocalPort 9000 -ErrorAction SilentlyContinue).Count) {
    throw 'Guardian is not listening on port 9000. Start it before this comparison.'
}
if (@(Get-NetTCPConnection -State Listen -LocalPort 9002 -ErrorAction SilentlyContinue).Count) {
    throw 'Port 9002 already has a listener. Keep the watch on Guardian and share that listener before continuing.'
}
$endpoints = @((Invoke-RestMethod 'http://127.0.0.1:4040/api/endpoints' -TimeoutSec 5).endpoints)
$guardianAddress = Get-WifiComparisonEndpoint $endpoints 9000
$recorderAddress = Get-WifiComparisonEndpoint $endpoints 9002
foreach ($address in @($guardianAddress, $recorderAddress)) {
    if (-not (Test-WifiComparisonTcp $address)) {
        throw "Public TCP endpoint unreachable: $address. Keep the watch on Guardian."
    }
}
if ($Backend -eq 'anytracking' -and
    -not (Test-WifiComparisonTcp ([Uri]'tcp://a.igps123.com:7720'))) {
    throw 'The supplier server is unreachable. Keep the watch on Guardian.'
}

$folder = Join-Path ([IO.Path]::GetTempPath()) ('guardian-wifi-' + [Guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $folder
$capture = Join-Path $folder ($Backend + '.jsonl')
$consoleLog = Join-Path $folder 'recorder.log'
$wifiArgs = @($recorder, '--backend', $Backend, '--protocol-id', $ProtocolId,
    '--return-url', $guardianAddress.AbsoluteUri, '--output', $capture, '--minutes', "$Minutes")

& node @wifiArgs
if ($LASTEXITCODE -ne 0) { throw 'Recorder preview failed. No routing change should be made.' }
Write-Host "CAPTURE: $capture"
Write-Host "LOG: $consoleLog"
Write-Host "TO RECORDER SMS: ip,$($recorderAddress.Host),$($recorderAddress.Port)#"
Write-Host "RETURN TO GUARDIAN SMS: ip,$($guardianAddress.Host),$($guardianAddress.Port)#"
Write-Host 'Send the recorder SMS only after wifi_observation_ready appears.'
Write-Host "Recorder lasts $Minutes minutes. Restore settings and Guardian routing before it finishes."
Write-Host 'While routed to AnyTracking, Guardian does not receive this watch telemetry or alarms.'
Write-Host 'Public TCP checks prove edge reachability only; verify upstream_connected and fresh watch frames after the SMS.'
$wifiArgs += '--run'
& node @wifiArgs | Tee-Object -FilePath $consoleLog
if ($LASTEXITCODE -ne 0) { throw 'Recorder outcome unconfirmed. Restore the current Guardian route and share the output.' }

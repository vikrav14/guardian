param(
    [ValidateSet('Check', 'Serve', 'Probe')][string]$Mode = 'Check',
    [string]$GuardianGateway = (Get-Location).Path,
    [string]$SessionFile,
    [string]$ControlUrl,
    [string]$DataUrl,
    [string]$UserId,
    [string]$Imei = '861397052547492',
    [string]$ProtocolId = '9705254749'
)
$ErrorActionPreference = 'Stop'
if ($Imei -notmatch '^\d{15}$' -or $ProtocolId -notmatch '^\d{10}$') {
    throw 'Provide the exact IMEI and protocol ID for this trial.'
}

# Isolated dependencies: never install Python packages into the running gateway.
$guardianPhotoEnvironment = Join-Path $env:LOCALAPPDATA 'Guardian\photo-ftp-python'
$guardianPhotoPython = Join-Path $guardianPhotoEnvironment 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $guardianPhotoPython)) {
    $guardianPythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $guardianPythonLauncher) {
        throw 'Python 3.10+ is required. Install it from python.org with the Windows py launcher, then run this command again.'
    }
    & py -3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }
    & py -3 -m venv $guardianPhotoEnvironment
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Python environment.' }
}
& $guardianPhotoPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'photo-ftp-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Photo diagnostic dependency installation failed.' }

if ($Mode -eq 'Check') {
    & $guardianPhotoPython (Join-Path $PSScriptRoot 'check_photo_ftp.py')
    if ($LASTEXITCODE -ne 0) { throw 'The local FTP self-test failed. No watch settings were changed.' }
    try {
        $guardianPhotoEndpoints = @((Invoke-RestMethod 'http://127.0.0.1:4040/api/endpoints' -TimeoutSec 10).endpoints)
        $guardianPhotoEndpoints | Select-Object name, url, @{Name='ForwardsTo';Expression={$_.upstream.url}} | Format-Table -AutoSize
        Write-Host 'FTP requires two TCP endpoints: control -> 127.0.0.1:2121 and data -> 127.0.0.1:2122.'
        Write-Host 'With three endpoint slots, preserving both Guardian and WhatsApp leaves room for only one FTP endpoint.'
        Write-Host 'No endpoints were created, stopped or changed.'
    } catch {
        Write-Host 'Could not read ngrok endpoints. Start ngrok before the public FTP trial.'
    }
    $guardianPhotoFirebaseArgs = @((Join-Path $PSScriptRoot 'photo-trial-firebase.js'), '--action', 'check', '--project-dir', $GuardianGateway, '--imei', $Imei)
    if ($UserId) { $guardianPhotoFirebaseArgs += @('--uid', $UserId) }
    & node @guardianPhotoFirebaseArgs
    if ($LASTEXITCODE -ne 0) { throw 'Firebase readiness check failed. The earlier local FTP test is separate; no Firebase writes were requested.' }
    Write-Host 'PHOTO READINESS CHECK COMPLETE. Paste the check results. No IP SMS or FTP watch commands are needed yet.'
    return
}

if ($Mode -eq 'Probe') {
    if (-not $SessionFile -or -not $ControlUrl) { throw 'Probe requires -SessionFile and -ControlUrl.' }
    & $guardianPhotoPython (Join-Path $PSScriptRoot 'photo_ftp_receiver.py') --probe --session $SessionFile --control-url $ControlUrl
    if ($LASTEXITCODE -ne 0) { throw 'Public FTP upload probe failed. Do not configure the watch yet.' }
    return
}

if (-not $ControlUrl -or -not $DataUrl) { throw 'Serve requires the current public -ControlUrl and -DataUrl.' }
if (-not $SessionFile) {
    $guardianPhotoRun = Join-Path $env:TEMP ('guardian-photo-ftp-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    & $guardianPhotoPython (Join-Path $PSScriptRoot 'photo_ftp_receiver.py') --init-dir $guardianPhotoRun --imei $Imei --protocol-id $ProtocolId
    if ($LASTEXITCODE -ne 0) { throw 'Photo session creation failed.' }
    $SessionFile = Join-Path $guardianPhotoRun 'session.json'
}
Write-Host "PRIVATE SESSION FILE: $SessionFile"
Write-Host 'Keep session.json private: it contains temporary FTP credentials, never Firebase credentials.'
Write-Host 'The receiver stops after 15 minutes. Stopping does not restore watch settings or ngrok endpoints.'
& $guardianPhotoPython (Join-Path $PSScriptRoot 'photo_ftp_receiver.py') --run --session $SessionFile --control-url $ControlUrl --data-url $DataUrl --minutes 15
if ($LASTEXITCODE -ne 0) { throw 'FTP receiver stopped with an error. Check its output.' }

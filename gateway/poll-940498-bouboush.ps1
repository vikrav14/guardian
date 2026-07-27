$logPath = "C:\Users\MSI\.cursor\projects\c-Users-MSI-repos-guardian\terminals\940498.txt"
$out = "C:\Users\MSI\repos\guardian\gateway\poll-940498-bouboush.log"
$imei = "861397053141170"
$baseline = (Get-Content $logPath -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
"START $(Get-Date -Format o) baselineLines=$baseline imei=$imei" | Out-File $out -Encoding utf8
for ($i=1; $i -le 16; $i++) {
  Start-Sleep -Seconds 45
  $lines = @(Get-Content $logPath -ErrorAction SilentlyContinue)
  if ($lines.Count -eq 0) {
    "POLL $i $(Get-Date -Format o) log missing" | Add-Content $out
    continue
  }
  $new = @()
  if ($lines.Count -gt $baseline) {
    $new = $lines[$baseline..($lines.Count-1)]
  }
  $baseline = $lines.Count
  $geo = @($new | Select-String -Pattern "\[geolocate\].*$imei").Count
  $ff = @($new | Select-String -Pattern "first_fix").Count
  $ud = @($new | Select-String -Pattern "UD_LTE").Count
  $imeiHits = @($new | Select-String -Pattern $imei).Count
  "POLL $i $(Get-Date -Format o) new=$($new.Count) geolocate=$geo first_fix=$ff ud_lte=$ud imei_lines=$imeiHits" | Add-Content $out
  $new | Select-String -Pattern "\[geolocate\]|first_fix|UD_LTE|$imei" | ForEach-Object { "  $($_.Line)" } | Add-Content $out
  if ($i -eq 4) {
    $cr = node C:\Users\MSI\repos\guardian\gateway\scripts\send-cr.js 861397053141170 2>&1
    "  [send-cr-repeat] $cr" | Add-Content $out
  }
}
"END $(Get-Date -Format o)" | Add-Content $out

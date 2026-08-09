$ErrorActionPreference = "Stop"

$target = "C:\Users\MSI\repos\guardian\apps\mobile\lib\screens\map_dashboard_page.dart"

if (!(Test-Path $target)) {
    Write-Host "ERROR: File not found: $target" -ForegroundColor Red
    exit 1
}

$content = Get-Content $target -Raw

$old = "'Battery `${device.batteryPercent}%',"
$new = "'Battery `${device!.batteryPercent}%',"

if ($content -notlike "*$old*") {
    Write-Host "ERROR: Expected battery line was not found. No changes made." -ForegroundColor Red
    exit 2
}

$content = $content.Replace($old, $new)
Set-Content -Path $target -Value $content -Encoding UTF8

Write-Host "Fixed battery nullability line in:" -ForegroundColor Green
Write-Host "  $target"
Write-Host ""
Write-Host "Next run:"
Write-Host '  cd "C:\Users\MSI\repos\guardian\apps\mobile"'
Write-Host "  dart format .\lib\screens\map_dashboard_page.dart"
Write-Host "  flutter analyze"

$ErrorActionPreference = "Stop"

$root = Get-Location
$dashPath = Join-Path $root "apps/mobile/lib/screens/map_dashboard_page.dart"

if (!(Test-Path $dashPath)) {
  Write-Host "ERROR: Run this from C:\Users\MSI\repos\guardian" -ForegroundColor Red
  exit 1
}

$dash = Get-Content $dashPath -Raw

# Add a promoted local battery value in _CarePersonSummary.
if ($dash -notmatch 'final battery = device\?\.batteryPercent;') {
  $dash = $dash.Replace(
@'
    final statusBackground =
        live ? GuardianColors.safeBg : GuardianColors.warningBg;

    final rawPlace = device?.location?.placeLabel?.trim();
'@,
@'
    final statusBackground =
        live ? GuardianColors.safeBg : GuardianColors.warningBg;
    final battery = device?.batteryPercent;

    final rawPlace = device?.location?.placeLabel?.trim();
'@
  )
}

# Use the promoted local instead of dereferencing nullable device.
$dash = $dash.Replace(
@'
                if (device?.batteryPercent != null) ...[
                  const SizedBox(width: 7),
                  Text(
                    'Battery ${device.batteryPercent}%',
'@,
@'
                if (battery != null) ...[
                  const SizedBox(width: 7),
                  Text(
                    'Battery $battery%',
'@
)

Set-Content -Path $dashPath -Value $dash -Encoding UTF8

Write-Host "Nullable battery fix applied." -ForegroundColor Green
Write-Host ""
Write-Host "Now run:"
Write-Host "  dart format apps/mobile/lib/screens/map_dashboard_page.dart"
Write-Host "  cd apps/mobile"
Write-Host "  flutter analyze"

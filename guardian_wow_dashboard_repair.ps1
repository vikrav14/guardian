$ErrorActionPreference = "Stop"

$root = Get-Location
$devicePath = Join-Path $root "apps/mobile/lib/models/device.dart"
$dashPath = Join-Path $root "apps/mobile/lib/screens/map_dashboard_page.dart"

if (!(Test-Path $devicePath) -or !(Test-Path $dashPath)) {
  Write-Host "ERROR: Run from C:\Users\MSI\repos\guardian" -ForegroundColor Red
  exit 1
}

$device = Get-Content $devicePath -Raw
$dash = Get-Content $dashPath -Raw

# --- Fix DeviceLocation.placeLabel robustly ---
if ($device -notmatch 'final String\?\s+placeLabel;') {
  $device = [regex]::Replace(
    $device,
    '(this\.satellites,\s*\r?\n\s*\}\);)',
    "this.satellites,`r`n    this.placeLabel,`r`n  });",
    1
  )

  $device = [regex]::Replace(
    $device,
    '(final int\?\s+satellites;)',
    "`$1`r`n  final String? placeLabel;",
    1
  )

  $device = [regex]::Replace(
    $device,
    "(satellites:\s*\(map\['satellites'\]\s+as\s+num\?\)\?\.toInt\(\),)",
    "`$1`r`n      placeLabel: map['placeLabel'] as String?,",
    1
  )
}

# --- Ensure AroundThemStrip is actually inserted in build ---
if ($dash -match 'class _AroundThemStrip extends StatelessWidget' -and
    $dash -notmatch '_AroundThemStrip\(\s*device:\s*selected') {

  $pattern = 'if \(selected != null\) \.\.\.\[\s*const SizedBox\(height: 18\),\s*_PrototypeHomePanels\('
  $replacement = @'
if (selected != null) ...[
                            const SizedBox(height: 18),
                            _AroundThemStrip(
                              device: selected,
                              geofences: _mapGeofences,
                              insight: insight,
                            ),
                            const SizedBox(height: 18),
                            _PrototypeHomePanels(
'@
  $newDash = [regex]::Replace(
    $dash,
    $pattern,
    $replacement,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if ($newDash -eq $dash) {
    Write-Host "WARNING: Could not auto-insert AroundThemStrip; continuing with other fixes." -ForegroundColor Yellow
  } else {
    $dash = $newDash
  }
}

# --- Remove unnecessary non-null assertion in battery copy ---
$dash = $dash.Replace("Battery `${device!.batteryPercent}%", "Battery `${device.batteryPercent}%")

Set-Content -Path $devicePath -Value $device -Encoding UTF8
Set-Content -Path $dashPath -Value $dash -Encoding UTF8

Write-Host "Guardian WOW repair applied." -ForegroundColor Green
Write-Host "Now run:"
Write-Host "  dart format apps/mobile/lib/models/device.dart apps/mobile/lib/screens/map_dashboard_page.dart"
Write-Host "  cd apps/mobile"
Write-Host "  flutter analyze"

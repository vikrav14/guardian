$ErrorActionPreference = "Stop"

$root = Get-Location
$devicePath = Join-Path $root "apps/mobile/lib/models/device.dart"
$dashPath = Join-Path $root "apps/mobile/lib/screens/map_dashboard_page.dart"

if (!(Test-Path $devicePath) -or !(Test-Path $dashPath)) {
    Write-Host "ERROR: Run this from the Guardian repo root:" -ForegroundColor Red
    Write-Host '  cd "C:\Users\MSI\repos\guardian"'
    exit 1
}

$device = Get-Content $devicePath -Raw
$dash = Get-Content $dashPath -Raw

# 1) DeviceLocation.placeLabel
if ($device -notmatch 'final String\? placeLabel;') {
    $device = $device.Replace(
@"
    this.recordedAt,
    this.satellites,
  });
"@,
@"
    this.recordedAt,
    this.satellites,
    this.placeLabel,
  });
"@
    )

    $device = $device.Replace(
@"
  final DateTime? recordedAt;
  final int? satellites;
"@,
@"
  final DateTime? recordedAt;
  final int? satellites;
  final String? placeLabel;
"@
    )

    $device = $device.Replace(
@"
      recordedAt: _asDateTime(map['recordedAt']),
      satellites: (map['satellites'] as num?)?.toInt(),
"@,
@"
      recordedAt: _asDateTime(map['recordedAt']),
      satellites: (map['satellites'] as num?)?.toInt(),
      placeLabel: map['placeLabel'] as String?,
"@
    )
}

# 2) Slightly reduce desktop map height
$dash = $dash.Replace(
    "height: compact ? 270 : 360,",
    "height: compact ? 260 : 310,"
)

# 3) Pass insight into care summary
$dash = $dash.Replace(
    "final summary = _CarePersonSummary(device: device);",
    "final summary = _CarePersonSummary(device: device, insight: insight);"
)

# 4) Replace _CarePersonSummary block
$careSummary = @'
class _CarePersonSummary extends StatelessWidget {
  const _CarePersonSummary({
    required this.device,
    required this.insight,
  });

  final Device? device;
  final DashboardInsight insight;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final name = device?.displayName ?? 'Someone you care for';
    final relationship = device?.relationshipLabel ?? 'No pendant linked';
    final live =
        device?.connectivityPhase() == DeviceConnectivityPhase.live;
    final reconnecting =
        device?.connectivityPhase() == DeviceConnectivityPhase.reconnecting;
    final status = device == null
        ? 'Waiting'
        : reconnecting
            ? 'Linking'
            : live
                ? 'Live'
                : 'Offline';
    final statusColor = live ? GuardianColors.safe : GuardianColors.warning;
    final statusBackground =
        live ? GuardianColors.safeBg : GuardianColors.warningBg;

    final rawPlace = device?.location?.placeLabel?.trim();
    final hasPlace = rawPlace != null &&
        rawPlace.isNotEmpty &&
        device?.location?.isValid == true;
    final headline = device == null
        ? 'Link a pendant to start Guardian.'
        : reconnecting
            ? 'I’m making secure contact with $name.'
            : live
                ? (hasPlace
                    ? '$name is connected at $rawPlace.'
                    : '$name is connected and Guardian is watching.')
                : 'Guardian is keeping $name’s last known state safe.';

    final topInference = device?.intelligence?.topInsight?.inference.trim();
    final guardianLine = topInference != null && topInference.isNotEmpty
        ? topInference
        : live
            ? 'No unusual device or location signals right now.'
            : insight.detail;

    return LayoutBuilder(
      builder: (context, constraints) {
        final horizontal = constraints.maxWidth >= 320;
        final avatar = AvatarBubble(
          initials: initialsFor(name),
          color: GuardianColors.safe,
          size: 58,
          imageUrl: device?.avatarUrl,
        );

        final copy = Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment:
              horizontal ? CrossAxisAlignment.start : CrossAxisAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: 12,
                  color: GuardianColors.safe,
                ),
                const SizedBox(width: 6),
                Text(
                  'GUARDIAN NOW',
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.15,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 7),
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: horizontal ? TextAlign.left : TextAlign.center,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 23,
                height: 1.05,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.7,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              relationship,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colors.textMuted, fontSize: 10),
            ),
            const SizedBox(height: 9),
            Text(
              headline,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: horizontal ? TextAlign.left : TextAlign.center,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 12,
                height: 1.35,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              guardianLine,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: horizontal ? TextAlign.left : TextAlign.center,
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 9,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusBackground,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '● $status',
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (device?.batteryPercent != null) ...[
                  const SizedBox(width: 7),
                  Text(
                    'Battery ${device!.batteryPercent}%',
                    style: TextStyle(
                      color: colors.textMuted,
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ],
        );

        if (horizontal) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              avatar,
              const SizedBox(width: 14),
              Expanded(child: copy),
            ],
          );
        }
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [avatar, const SizedBox(height: 12), copy],
        );
      },
    );
  }
}
'@

$pattern = 'class _CarePersonSummary extends StatelessWidget \{.*?\r?\n\}\r?\n\r?\nclass _DodoStagePlaceholder'
$replacement = $careSummary + "`r`n`r`nclass _DodoStagePlaceholder"
$newDash = [regex]::Replace($dash, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($newDash -eq $dash) {
    Write-Host "ERROR: Could not replace _CarePersonSummary block." -ForegroundColor Red
    exit 2
}
$dash = $newDash

# 5) Fix GPS state when a last-known position exists
$dash = $dash.Replace(
@"
    final connected = phase == DeviceConnectivityPhase.live;
    final gps = selected?.hasFreshLocation == true;
    final approximate = selected?.hasApproximateLocation == true;
"@,
@"
    final connected = phase == DeviceConnectivityPhase.live;
    final gps = selected?.hasFreshLocation == true;
    final hasPosition = selected?.location?.isValid == true;
    final approximate = selected?.hasApproximateLocation == true;
"@
)

$dash = $dash.Replace(
@"
        label: approximate
            ? 'Approximate'
            : (gps ? 'GPS active' : 'GPS waiting'),
        active: gps,
"@,
@"
        label: approximate
            ? 'Approximate'
            : gps
                ? 'GPS active'
                : hasPosition
                    ? 'Last known'
                    : 'Locating',
        active: hasPosition,
"@
)

# 6) Around Them section
$aroundClasses = @'
class _AroundThemStrip extends StatelessWidget {
  const _AroundThemStrip({
    required this.device,
    required this.geofences,
    required this.insight,
  });

  final Device device;
  final List<Geofence> geofences;
  final DashboardInsight insight;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final rawPlace = device.location?.placeLabel?.trim();
    final place = rawPlace != null && rawPlace.isNotEmpty
        ? rawPlace
        : device.hasFreshLocation
            ? 'Position received'
            : 'Waiting for location';
    final battery = device.batteryPercent;
    final deviceHealth = battery == null
        ? (device.isLiveConnected ? 'Connected' : 'Last contact saved')
        : '${device.isLiveConnected ? 'Connected' : 'Last contact'} · $battery%';
    final zoneLabel = geofences.isEmpty
        ? 'No active safe zones'
        : geofences.length == 1
            ? '1 active safe zone'
            : '${geofences.length} active safe zones';
    final aiTitle = device.intelligence?.topInsight?.inference.trim();
    final aiValue = aiTitle != null && aiTitle.isNotEmpty
        ? aiTitle
        : 'No unusual signals right now';

    return _PrototypePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: _PrototypePanelHeading(
                  eyebrow: 'AROUND THEM',
                  title: 'Guardian is checking the world around them',
                  compact: true,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: GuardianColors.safeBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  '● Context live',
                  style: TextStyle(
                    color: GuardianColors.safe,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 860
                  ? 4
                  : constraints.maxWidth >= 500
                      ? 2
                      : 1;
              const gap = 9.0;
              final width =
                  (constraints.maxWidth - gap * (columns - 1)) / columns;
              final cards = [
                _AroundSignal(
                  icon: Icons.location_on_rounded,
                  label: 'Location',
                  value: place,
                  note: device.hasApproximateLocation
                      ? 'Approximate positioning'
                      : device.hasFreshLocation
                          ? 'Latest position'
                          : 'Guardian will update this',
                  color: GuardianColors.safe,
                  background: GuardianColors.safeBg,
                ),
                const _AroundSignal(
                  icon: Icons.cloud_outlined,
                  label: 'Weather',
                  value: 'Watching conditions',
                  note: 'Only surfaced when it matters',
                  color: GuardianColors.accent,
                  background: GuardianColors.accentBg,
                ),
                _AroundSignal(
                  icon: Icons.shield_outlined,
                  label: 'Safe zones',
                  value: zoneLabel,
                  note: 'Location rules stay active',
                  color: GuardianColors.safe,
                  background: GuardianColors.safeBg,
                ),
                _AroundSignal(
                  icon: Icons.auto_awesome_rounded,
                  label: 'Guardian AI',
                  value: aiValue,
                  note: deviceHealth,
                  color: const Color(0xFF8058BE),
                  background: const Color(0xFFF2ECFB),
                ),
              ];
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: [
                  for (final card in cards)
                    SizedBox(width: width, child: card),
                ],
              );
            },
          ),
          const SizedBox(height: 10),
          Text(
            'Local reports and external signals stay quiet unless they are relevant to ${device.displayName}.',
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 8,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _AroundSignal extends StatelessWidget {
  const _AroundSignal({
    required this.icon,
    required this.label,
    required this.value,
    required this.note,
    required this.color,
    required this.background,
  });

  final IconData icon;
  final String label;
  final String value;
  final String note;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      constraints: const BoxConstraints(minHeight: 88),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFBFCFB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 17, color: color),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 7,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .8,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10,
                    height: 1.25,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  note,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: colors.textMuted, fontSize: 7),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
'@

if ($dash -notmatch 'class _AroundThemStrip extends StatelessWidget') {
    $dash = $dash.Replace(
        "class _PrototypeHomePanels extends StatelessWidget {",
        $aroundClasses + "`r`n`r`nclass _PrototypeHomePanels extends StatelessWidget {"
    )
}

$dash = $dash.Replace(
@"
                          if (selected != null) ...[
                            const SizedBox(height: 18),
                            _PrototypeHomePanels(
"@,
@"
                          if (selected != null) ...[
                            const SizedBox(height: 18),
                            _AroundThemStrip(
                              device: selected,
                              geofences: _mapGeofences,
                              insight: insight,
                            ),
                            const SizedBox(height: 18),
                            _PrototypeHomePanels(
"@
)

# 7) Use place label in Today card
$dash = $dash.Replace(
@"
    final locationLabel = device.hasApproximateLocation
        ? 'Approximate location'
        : device.hasFreshLocation
            ? 'Latest position received'
            : 'Waiting for a position';
"@,
@"
    final rawPlace = device.location?.placeLabel?.trim();
    final locationLabel =
        device.hasFreshLocation && rawPlace != null && rawPlace.isNotEmpty
            ? rawPlace
            : device.hasApproximateLocation
                ? 'Approximate location'
                : device.location?.isValid == true
                    ? 'Last known position'
                    : 'Waiting for a position';
"@
)

$dash = $dash.Replace(
    "'Journey details stay together on the Journey screen.'",
    "'Guardian keeps today’s movement together so changes are easy to spot.'"
)

# 8) Rename communication card
$dash = $dash.Replace(
@"
                  eyebrow: 'COMMUNICATION ACTIVITY',
                  title: 'Everything is flowing',
"@,
@"
                  eyebrow: 'GUARDIAN INTELLIGENCE',
                  title: 'Quietly checking what matters',
"@
)

Set-Content -Path $devicePath -Value $device -Encoding UTF8
Set-Content -Path $dashPath -Value $dash -Encoding UTF8

Write-Host "Guardian WOW dashboard patch applied." -ForegroundColor Green
Write-Host "Changed:"
Write-Host "  apps/mobile/lib/models/device.dart"
Write-Host "  apps/mobile/lib/screens/map_dashboard_page.dart"
Write-Host ""
Write-Host "Next:"
Write-Host "  dart format apps/mobile/lib/models/device.dart apps/mobile/lib/screens/map_dashboard_page.dart"
Write-Host "  cd apps/mobile"
Write-Host "  flutter analyze"
Write-Host "  flutter run -d chrome"

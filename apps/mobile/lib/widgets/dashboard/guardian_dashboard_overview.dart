import 'package:flutter/material.dart';

import '../../dashboard/device_formatters.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../theme/app_theme.dart';
import 'dashboard_section_icon.dart';
import 'guardian_overview_header.dart';

/// Presentation only. Watch actions, entitlements and map evidence are supplied
/// by the page, so changes here do not change location or safety policy.
class GuardianDashboardOverview extends StatelessWidget {
  const GuardianDashboardOverview({
    super.key,
    required this.device,
    required this.devices,
    required this.geofences,
    required this.map,
    required this.mapStatus,
    required this.insight,
    required this.aiEnabled,
    required this.helpEnabled,
    required this.careEnabled,
    required this.todaySummary,
    required this.activityStatus,
    required this.onSelect,
    this.loading = false,
    this.hasError = false,
    this.onCall,
    this.onJourney,
    this.onHelp,
    this.onWatchStatus,
    this.onLocationDetails,
    this.onSafeZones,
    this.onLinkWatch,
    this.serviceSections = const [],
  });

  final Device? device;
  final List<Device> devices;
  final List<Geofence> geofences;
  final Widget map;
  final String mapStatus;
  final String insight;
  final bool aiEnabled;
  final bool helpEnabled;
  final bool careEnabled;
  final String todaySummary;
  final String activityStatus;
  final ValueChanged<String> onSelect;
  final bool loading;
  final bool hasError;
  final VoidCallback? onCall;
  final VoidCallback? onJourney;
  final VoidCallback? onHelp;
  final VoidCallback? onWatchStatus;
  final VoidCallback? onLocationDetails;
  final VoidCallback? onSafeZones;
  final VoidCallback? onLinkWatch;

  /// Optional activity/Care panels, already authorized by the owning page.
  /// An empty list keeps unfinished service features absent from the dashboard.
  final List<Widget> serviceSections;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final selected = device;
    final compact = MediaQuery.sizeOf(context).width < 600;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(
            'Family overview',
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: compact ? 24 : 28,
              height: 1.2,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.7,
            ),
          ),
        ),
        if (!compact) ...[
          const SizedBox(height: 6),
          Text(
            'The people who matter, in one place.',
            style: TextStyle(color: colors.textSecondary, fontSize: 15),
          ),
        ],
        SizedBox(height: compact ? 12 : 24),
        if (hasError) ...[
          _DashboardNotice(
            icon: Icons.cloud_off_outlined,
            title: 'Watch updates are unavailable',
            message: selected == null
                ? 'Check your connection and try opening Home again.'
                : 'Showing the last information received. Check your connection.',
          ),
          const SizedBox(height: 16),
        ],
        if (selected == null)
          _EmptyOverview(
            loading: loading,
            hasError: hasError,
            onLinkWatch: onLinkWatch,
          )
        else ...[
          if (devices.length > 1) ...[
            _FamilySelector(
              devices: devices,
              selectedImei: selected.imei,
              onSelect: onSelect,
            ),
            const SizedBox(height: 16),
          ],
          GuardianOverviewHeader(
            device: selected,
            helpEnabled: helpEnabled,
            onCall: onCall,
            onJourney: onJourney,
            onHelp: onHelp,
            onWatchStatus: onWatchStatus,
          ),
          SizedBox(height: compact ? 12 : 20),
          LayoutBuilder(
            builder: (context, constraints) {
              final location = _LocationPanel(
                device: selected,
                map: map,
                status: mapStatus,
                onDetails: onLocationDetails,
              );
              final details = Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SafeZonesPanel(
                    device: selected,
                    geofences: geofences,
                    onManage: onSafeZones,
                  ),
                  if (aiEnabled) ...[
                    const SizedBox(height: 20),
                    _InsightPanel(message: insight),
                  ],
                ],
              );
              final wide =
                  constraints.maxWidth >= 960 &&
                  MediaQuery.textScalerOf(context).scale(14) <= 20;
              if (!wide) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    location,
                    SizedBox(height: compact ? 12 : 20),
                    details,
                  ],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 19, child: location),
                  const SizedBox(width: 20),
                  Expanded(flex: 10, child: details),
                ],
              );
            },
          ),
          for (final section in serviceSections) ...[
            SizedBox(height: compact ? 12 : 20),
            section,
          ],
          if (careEnabled) ...[
            const SizedBox(height: 20),
            _DashboardSurface(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle(
                    icon: Icons.calendar_today_outlined,
                    title: 'Today',
                  ),
                  const SizedBox(height: 16),
                  Text(todaySummary, style: _bodyStyle(context, strong: true)),
                  const SizedBox(height: 8),
                  Text(activityStatus, style: _bodyStyle(context)),
                ],
              ),
            ),
          ],
        ],
      ],
    );
  }
}

class _LocationPanel extends StatelessWidget {
  const _LocationPanel({
    required this.device,
    required this.map,
    required this.status,
    this.onDetails,
  });

  final Device device;
  final Widget map;
  final String status;
  final VoidCallback? onDetails;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final compact = MediaQuery.sizeOf(context).width < 600;
    final inset = compact ? 12.0 : 24.0;
    final location = device.mapDisplayLocation;
    final hasLocation = location?.isValid == true;
    final place = location?.placeLabel?.trim();
    final fixLabel = deviceMapLocationFixLabel(device);
    final recorded = location?.recordedAt;
    final age = recorded == null ? null : DateTime.now().difference(recorded);
    final timeKnown = age != null && age >= const Duration(minutes: -1);
    // Presentation only: age describes the displayed map fix, never heartbeat
    // freshness, and does not change the selected location or safety policy.
    final stale = timeKnown && age > deviceLocationFreshnessSlack;
    final retained = device.isMapDisplayingLastSatelliteLocation;
    final source = location?.source ?? device.displayLocationSource;
    final satellite = retained || source == 'gps';
    final approximate = !retained && (source == 'wifi' || source == 'lbs');
    // PR #116 supplies this source only after validating Home radio evidence.
    final homeWifi = source == 'home_wifi';
    final ageLabel = !timeKnown
        ? 'Time unavailable'
        : age.inMinutes < 1
        ? 'Just now'
        : age.inMinutes < 60
        ? '${age.inMinutes}m ago'
        : age.inHours < 24
        ? '${age.inHours}h ago'
        : '${age.inDays}d ago';
    final heading = !hasLocation
        ? 'Location'
        : retained || (satellite && stale)
        ? 'Last known location'
        : status;
    final caution = stale || retained || approximate || homeWifi || !timeKnown;
    final tone = caution
        ? Theme.of(context).brightness == Brightness.dark
              ? GuardianColors.warning
              : GuardianColors.warningText
        : colors.textSecondary;

    return _DashboardSurface(
      padding: EdgeInsets.all(inset),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final title = Semantics(
                header: true,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.location_on_rounded,
                      size: 22,
                      color: colors.accent,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        heading,
                        style: _bodyStyle(context, strong: true),
                      ),
                    ),
                  ],
                ),
              );
              final timestamp = Tooltip(
                message: timeKnown ? fixLabel : 'Location time unavailable',
                child: Semantics(
                  label: timeKnown ? fixLabel : 'Location time unavailable',
                  excludeSemantics: true,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: caution
                          ? tone.withValues(alpha: 0.09)
                          : colors.surfaceMuted,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.schedule_rounded, size: 16, color: tone),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            ageLabel,
                            style: TextStyle(fontSize: 12, color: tone),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
              if (!hasLocation) return title;
              if (constraints.maxWidth < 310 ||
                  MediaQuery.textScalerOf(context).scale(14) > 18) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [title, const SizedBox(height: 6), timestamp],
                );
              }
              return Row(
                children: [
                  Expanded(child: title),
                  const SizedBox(width: 8),
                  timestamp,
                ],
              );
            },
          ),
          const SizedBox(height: 8),
          Text(
            !hasLocation
                ? 'Waiting for a location'
                : place?.isNotEmpty == true
                ? place!
                : 'Recorded position',
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: compact ? 20 : 24,
              fontWeight: FontWeight.w700,
              height: 1.25,
              letterSpacing: -0.4,
            ),
          ),
          if (!hasLocation) ...[
            const SizedBox(height: 6),
            Text(
              'The watch has not shared a recorded position yet.',
              style: _bodyStyle(context),
            ),
          ],
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Stack(
              children: [
                ExcludeSemantics(excluding: !hasLocation, child: map),
                if (!hasLocation)
                  Positioned.fill(
                    child: Container(
                      color: colors.surfaceMuted,
                      alignment: Alignment.center,
                      child: Icon(
                        Icons.location_searching_rounded,
                        size: 40,
                        color: colors.textSecondary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (hasLocation && caution) ...[
            const SizedBox(height: 8),
            _LocationEvidenceNote(
              color: tone,
              title: !timeKnown
                  ? 'Location time unavailable.'
                  : homeWifi
                  ? 'At or near saved Home.'
                  : satellite && stale
                  ? 'No recent GPS update.'
                  : approximate
                  ? 'Approximate location.'
                  : satellite
                  ? 'Showing the last GPS position.'
                  : 'Showing the last known location.',
              message: homeWifi
                  ? 'Home Wi-Fi evidence places the watch near your saved Home pin. Open location details for the retained GPS fix.'
                  : retained
                  ? 'Showing the last reliable GPS position. A newer network estimate is approximate.'
                  : approximate
                  ? 'This network estimate may cover a wider area.'
                  : 'Showing the last known location.',
            ),
          ],
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: onDetails,
              style: _textButtonStyle(context),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Flexible(child: Text('Location details')),
                  const SizedBox(width: 8),
                  Icon(
                    Icons.arrow_forward_rounded,
                    size: 18,
                    color: colors.accent,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LocationEvidenceNote extends StatelessWidget {
  const _LocationEvidenceNote({
    required this.color,
    required this.title,
    required this.message,
  });

  final Color color;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '$title\n',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(text: message),
                ],
              ),
              style: TextStyle(color: color, fontSize: 13, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _SafeZonesPanel extends StatelessWidget {
  const _SafeZonesPanel({
    required this.device,
    required this.geofences,
    this.onManage,
  });

  final Device device;
  final List<Geofence> geofences;
  final VoidCallback? onManage;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final zones = geofences
        .where(
          (zone) =>
              zone.imei == device.imei &&
              zone.active &&
              !(zone.lat == 0 && zone.lng == 0),
        )
        .toList(growable: false);
    return _DashboardSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionTitle(icon: Icons.shield_outlined, title: 'Safe zones'),
          const SizedBox(height: 16),
          Text(
            zones.isEmpty
                ? 'No active zones'
                : '${zones.length} active zone${zones.length == 1 ? '' : 's'}',
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.w600,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            zones.isEmpty
                ? 'Add a familiar place, such as home or school.'
                : 'Saved places for ${device.displayName}.',
            style: _bodyStyle(context),
          ),
          if (zones.isNotEmpty) ...[
            const SizedBox(height: 16),
            for (final zone in zones.take(3))
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.place_outlined,
                      size: 20,
                      color: colors.textSecondary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        zone.name,
                        style: _bodyStyle(context, strong: true),
                      ),
                    ),
                  ],
                ),
              ),
            if (zones.length > 3)
              Text('+${zones.length - 3} more', style: _bodyStyle(context)),
          ],
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: onManage,
            label: const Text('Manage safe zones'),
            icon: const Icon(Icons.arrow_forward_rounded, size: 18),
            style: _textButtonStyle(context),
          ),
        ],
      ),
    );
  }
}

class _InsightPanel extends StatelessWidget {
  const _InsightPanel({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return _DashboardSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionTitle(
            icon: Icons.auto_awesome_outlined,
            title: 'Guardian insight',
          ),
          const SizedBox(height: 16),
          Text(message, style: _bodyStyle(context)),
        ],
      ),
    );
  }
}

class _FamilySelector extends StatelessWidget {
  const _FamilySelector({
    required this.devices,
    required this.selectedImei,
    required this.onSelect,
  });
  final List<Device> devices;
  final String selectedImei;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final device in devices)
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 260),
            child: ChoiceChip(
              label: Text(device.displayName, overflow: TextOverflow.ellipsis),
              selected: device.imei == selectedImei,
              onSelected: (_) => onSelect(device.imei),
              selectedColor: colors.accentMuted,
              backgroundColor: colors.surface,
              labelStyle: TextStyle(color: colors.textPrimary, fontSize: 14),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              side: BorderSide(color: colors.border),
              showCheckmark: true,
            ),
          ),
      ],
    );
  }
}

class _EmptyOverview extends StatelessWidget {
  const _EmptyOverview({
    required this.loading,
    required this.hasError,
    this.onLinkWatch,
  });
  final bool loading;
  final bool hasError;
  final VoidCallback? onLinkWatch;

  @override
  Widget build(BuildContext context) {
    if (hasError) return const SizedBox.shrink();
    return _DashboardSurface(
      child: Column(
        children: [
          const SizedBox(height: 20),
          if (loading)
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Icon(
              Icons.watch_outlined,
              color: context.guardianColors.textSecondary,
              size: 40,
            ),
          const SizedBox(height: 20),
          Text(
            loading ? 'Loading your watches' : 'Bring your family into view',
            textAlign: TextAlign.center,
            style: _bodyStyle(context, strong: true).copyWith(fontSize: 20),
          ),
          if (!loading) ...[
            const SizedBox(height: 8),
            Text(
              'Link a Guardian watch to see its location and status.',
              textAlign: TextAlign.center,
              style: _bodyStyle(context),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              onPressed: onLinkWatch,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Link a watch'),
              style: _textButtonStyle(context),
            ),
          ],
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

class _DashboardNotice extends StatelessWidget {
  const _DashboardNotice({
    required this.icon,
    required this.title,
    required this.message,
  });
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return _DashboardSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionTitle(icon: icon, title: title),
          const SizedBox(height: 8),
          Text(message, style: _bodyStyle(context)),
        ],
      ),
    );
  }
}

class _DashboardSurface extends StatelessWidget {
  const _DashboardSurface({required this.child, this.padding});
  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      clipBehavior: Clip.antiAlias,
      padding:
          padding ??
          EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 16 : 24),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.border),
      ),
      child: child,
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Row(
        children: [
          DashboardSectionIcon(icon: icon),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: _bodyStyle(context, strong: true).copyWith(fontSize: 15),
            ),
          ),
        ],
      ),
    );
  }
}

TextStyle _bodyStyle(BuildContext context, {bool strong = false}) => TextStyle(
  color: strong
      ? context.guardianColors.textPrimary
      : context.guardianColors.textSecondary,
  fontSize: 14,
  fontWeight: strong ? FontWeight.w600 : FontWeight.w400,
  height: 1.5,
);

ButtonStyle _textButtonStyle(BuildContext context) => TextButton.styleFrom(
  foregroundColor: context.guardianColors.textPrimary,
  minimumSize: const Size(48, 48),
  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
  textStyle: Theme.of(
    context,
  ).textTheme.labelLarge?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
);

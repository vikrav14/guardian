import 'package:flutter/material.dart';

import '../../models/alert.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';
import 'safe_zone_map.dart';

typedef SafeZoneMapBuilder = Widget Function(BuildContext context, Geofence zone);

/// Saved-zone presentation only. Detection, authorization and writes stay in
/// the existing services. A zone's active state is not a wearer safety claim.
class SafeZonesOverview extends StatefulWidget {
  const SafeZonesOverview({
    super.key,
    required this.zones,
    required this.devices,
    required this.alerts,
    required this.onAdd,
    required this.onToggle,
    required this.onDelete,
    required this.onExpand,
    this.onAlerts,
    this.busyZoneIds = const {},
    this.alertsLoading = false,
    this.alertsUnavailable = false,
    this.mapBuilder,
  });

  final List<Geofence> zones;
  final List<Device> devices;
  final List<GuardianAlert> alerts;
  final VoidCallback onAdd;
  final ValueChanged<Geofence> onToggle;
  final ValueChanged<Geofence> onDelete;
  final ValueChanged<Geofence> onExpand;
  final VoidCallback? onAlerts;
  final Set<String> busyZoneIds;
  final bool alertsLoading;
  final bool alertsUnavailable;
  final SafeZoneMapBuilder? mapBuilder;

  @override
  State<SafeZonesOverview> createState() => _SafeZonesOverviewState();
}

class _SafeZonesOverviewState extends State<SafeZonesOverview> {
  String? _selectedId;

  @override
  void initState() {
    super.initState();
    _keepSelection();
  }

  @override
  void didUpdateWidget(covariant SafeZonesOverview oldWidget) {
    super.didUpdateWidget(oldWidget);
    _keepSelection();
  }

  void _keepSelection() {
    if (!widget.zones.any((zone) => zone.id == _selectedId)) {
      _selectedId = widget.zones.isEmpty ? null : widget.zones.first.id;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    Geofence? selected;
    for (final zone in widget.zones) {
      if (zone.id == _selectedId) selected = zone;
    }
    selected ??= widget.zones.isEmpty ? null : widget.zones.first;
    final zone = selected;
    final active = widget.zones.where((zone) => zone.active).length;
    final compact = MediaQuery.sizeOf(context).width < 600;
    final add = FilledButton.icon(
      onPressed: widget.onAdd,
      icon: const Icon(Icons.add_rounded, size: 20),
      label: const Text('Add zone'),
      style: _primary(context),
    );
    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text('Safe zones', style: TextStyle(
            color: colors.textPrimary,
            fontSize: compact ? 26 : 30,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.7,
          )),
        ),
        const SizedBox(height: 6),
        Text('Familiar places, clearly mapped.', style: _body(context)),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(builder: (context, constraints) {
          if (constraints.maxWidth < 520 || MediaQuery.textScalerOf(context).scale(14) > 20) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [heading, const SizedBox(height: 16), add],
            );
          }
          return Row(children: [Expanded(child: heading), const SizedBox(width: 24), add]);
        }),
        const SizedBox(height: 20),
        if (zone == null)
          _ZoneSurface(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.add_location_alt_outlined, size: 32, color: colors.accent),
              const SizedBox(height: 16),
              Text('Add a place that matters', style: _title(context)),
              const SizedBox(height: 8),
              Text('Save home, school or another familiar place, then choose its boundary on the map.', style: _body(context)),
            ],
          ))
        else ...[
          Text('$active active · ${widget.zones.length} saved', style: _body(context)),
          if (widget.zones.length > 1) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final item in widget.zones)
                  ChoiceChip(
                    key: ValueKey('select-zone-${item.id}'),
                    label: Text('${item.name} · ${deviceForZone(item, widget.devices)?.displayName ?? 'Unlinked watch'}'),
                    selected: item.id == zone.id,
                    onSelected: (_) => setState(() => _selectedId = item.id),
                    selectedColor: colors.accentMuted,
                    backgroundColor: colors.surface,
                    side: BorderSide(color: colors.border),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                    labelStyle: TextStyle(color: colors.textPrimary, fontSize: 14),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          LayoutBuilder(builder: (context, constraints) {
            final wide = constraints.maxWidth >= 900 && MediaQuery.textScalerOf(context).scale(14) <= 20;
            final map = _ZoneSurface(
              padding: EdgeInsets.zero,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(zone.name, style: _title(context)),
                        const SizedBox(height: 4),
                        Text('Saved zone boundary', style: _body(context)),
                      ],
                    ),
                  ),
                  SizedBox(
                    height: wide ? 370 : 250,
                    child: widget.mapBuilder?.call(context, zone) ?? SafeZoneMap(zone: zone),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: SafeZoneMapGeometry.fromZone(zone) == null ? null : () => widget.onExpand(zone),
                        icon: const Icon(Icons.open_in_full_rounded, size: 20),
                        label: const Text('Expand map'),
                        style: _textButton(context),
                      ),
                    ),
                  ),
                ],
              ),
            );
            final details = _ZoneDetails(
              zone: zone,
              device: deviceForZone(zone, widget.devices),
              alerts: widget.alerts,
              alertsLoading: widget.alertsLoading,
              alertsUnavailable: widget.alertsUnavailable,
              busy: widget.busyZoneIds.contains(zone.id),
              onToggle: () => widget.onToggle(zone),
              onDelete: () => widget.onDelete(zone),
              onAlerts: widget.onAlerts,
            );
            if (!wide) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [map, const SizedBox(height: 16), details],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [Expanded(flex: 3, child: map), const SizedBox(width: 20), Expanded(flex: 2, child: details)],
            );
          }),
        ],
      ],
    );
  }
}

class _ZoneDetails extends StatelessWidget {
  const _ZoneDetails({
    required this.zone,
    required this.device,
    required this.alerts,
    required this.alertsLoading,
    required this.alertsUnavailable,
    required this.busy,
    required this.onToggle,
    required this.onDelete,
    this.onAlerts,
  });

  final Geofence zone;
  final Device? device;
  final List<GuardianAlert> alerts;
  final bool alertsLoading;
  final bool alertsUnavailable;
  final bool busy;
  final VoidCallback onToggle;
  final VoidCallback onDelete;
  final VoidCallback? onAlerts;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final hasEmergency = alerts.any((alert) => alertMatchesZone(alert, zone) && isEmergencyAlert(alert));
    GuardianAlert? event;
    for (final alert in alerts) {
      // Only explicitly zone-bound events belong in this place's history.
      if (alert.imei != zone.imei || alert.payload?['geofenceId'] != zone.id ||
          (alert.type != 'geofence_enter' && alert.type != 'geofence_exit') ||
          alert.createdAt == null) continue;
      if (event == null || alert.createdAt!.isAfter(event.createdAt!)) event = alert;
    }
    final latest = event;
    final radius = zone.radiusMeters;
    final radiusLabel = radius.isFinite && radius > 0 ? '${radius.round()} m radius' : 'Radius unavailable';

    return _ZoneSurface(child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Icon(zone.active ? Icons.shield_outlined : Icons.pause_circle_outline_rounded, color: colors.accent, size: 24),
          const SizedBox(width: 10),
          Expanded(child: Text(zone.active ? 'Zone active' : 'Zone paused', style: _title(context))),
        ]),
        const SizedBox(height: 18),
        _ZoneFact(icon: Icons.person_outline_rounded, title: 'Assigned to', value: device?.displayName ?? 'Linked watch unavailable'),
        const SizedBox(height: 16),
        _ZoneFact(icon: Icons.radar_rounded, title: 'Boundary', value: radiusLabel),
        const SizedBox(height: 16),
        Text(zone.active ? 'Arrival and departure alerts use this saved boundary.' : 'Arrival and departure alerts are paused for this zone.', style: _body(context)),
        Divider(height: 32, color: colors.border),
        if (alertsUnavailable)
          Text('Alert history is unavailable. Try reopening Safe zones.', style: _body(context))
        else if (alertsLoading)
          Text('Checking alert history…', style: _body(context))
        else ...[
          if (hasEmergency) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: GuardianColors.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Unresolved emergency alert', style: _body(context).copyWith(color: colors.textPrimary, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text('An alert for this assigned watch still needs review. This does not establish its current location.', style: _body(context)),
                  TextButton.icon(
                    onPressed: onAlerts,
                    icon: const Icon(Icons.arrow_forward_rounded, size: 18),
                    label: const Text('Review alerts'),
                    style: _textButton(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          Text('Latest recorded event', style: _body(context).copyWith(fontWeight: FontWeight.w700, color: colors.textPrimary)),
          const SizedBox(height: 6),
          Text(latest == null ? 'No arrival or departure in the available history for this zone.' : '${latest.type == 'geofence_enter' ? 'Arrival recorded' : 'Departure recorded'} · ${_eventTime(latest.createdAt!)}', style: _body(context)),
        ],
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: busy ? null : onToggle,
          icon: Icon(zone.active ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 20),
          label: Text(busy ? 'Updating…' : zone.active ? 'Pause zone' : 'Activate zone'),
          style: OutlinedButton.styleFrom(
            foregroundColor: colors.textPrimary,
            minimumSize: const Size(48, 48),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            side: BorderSide(color: colors.border),
          ),
        ),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: busy ? null : onDelete,
          icon: const Icon(Icons.delete_outline_rounded, size: 20),
          label: const Text('Delete zone'),
          style: _textButton(context),
        ),
      ],
    ));
  }
}

String _eventTime(DateTime at) {
  if (at.isAfter(DateTime.now().add(const Duration(minutes: 1)))) return 'Time unavailable';
  return relativeTimeLabel(at);
}

class _ZoneFact extends StatelessWidget {
  const _ZoneFact({required this.icon, required this.title, required this.value});
  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 22, color: context.guardianColors.textSecondary),
        const SizedBox(width: 10),
        Expanded(child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [Text(title, style: _body(context)), const SizedBox(height: 3), Text(value, style: _body(context).copyWith(fontWeight: FontWeight.w600, color: context.guardianColors.textPrimary))],
        )),
      ],
    );
  }
}

class _ZoneSurface extends StatelessWidget {
  const _ZoneSurface({required this.child, this.padding = const EdgeInsets.all(20)});
  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: context.guardianColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: context.guardianColors.border)),
      child: child,
    );
  }
}

TextStyle _body(BuildContext context) => TextStyle(color: context.guardianColors.textSecondary, fontSize: 14, height: 1.45);
TextStyle _title(BuildContext context) => TextStyle(color: context.guardianColors.textPrimary, fontSize: 21, fontWeight: FontWeight.w700, height: 1.25);
ButtonStyle _primary(BuildContext context) => FilledButton.styleFrom(backgroundColor: GuardianColors.forest, foregroundColor: Colors.white, minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12));
ButtonStyle _textButton(BuildContext context) => TextButton.styleFrom(foregroundColor: context.guardianColors.textPrimary, minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12));

Future<bool> confirmSafeZoneDeletion(BuildContext context, Geofence zone) async {
  return await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Delete safe zone?'),
      content: Text('Remove "${zone.name}" and stop future arrival and departure alerts for it? You can pause the zone instead to keep its saved boundary.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep zone')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete zone')),
      ],
    ),
  ) ?? false;
}

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../theme/colors.dart';

/// Inferred from [Geofence.name] — Firestore has no dedicated type field yet.
enum SafeZoneCategory { home, school, church, work, hiking, other }

/// Visual + semantic status for a zone card chip.
enum SafeZoneStatus { safe, outside, emergency, paused, unknown }

class SafeZoneCategoryStyle {
  const SafeZoneCategoryStyle({
    required this.category,
    required this.label,
    required this.color,
    required this.background,
    required this.icon,
  });

  final SafeZoneCategory category;
  final String label;
  final Color color;
  final Color background;
  final IconData icon;
}

class SafeZoneStatusStyle {
  const SafeZoneStatusStyle({
    required this.status,
    required this.label,
    required this.foreground,
    required this.background,
  });

  final SafeZoneStatus status;
  final String label;
  final Color foreground;
  final Color background;
}

class SafeZonesHeroSummary {
  const SafeZonesHeroSummary({
    required this.activeZoneCount,
    required this.totalZoneCount,
    required this.headline,
    required this.detail,
    required this.tone,
    this.lastEventLabel,
    this.lastEventAt,
  });

  final int activeZoneCount;
  final int totalZoneCount;
  final String headline;
  final String detail;
  final SafeZoneStatus tone;
  final String? lastEventLabel;
  final DateTime? lastEventAt;
}

/// Occupants shown on a zone card.
///
/// Schema v1: each geofence document stores a single [Geofence.imei]. There is
/// no multi-wearer assignment field yet, so we show the linked device whose IMEI
/// matches the zone. Phase 2+ could introduce explicit occupant lists.
List<Device> occupantsForZone(Geofence zone, List<Device> devices) {
  return devices.where((d) => d.imei == zone.imei).toList();
}

Device? deviceForZone(Geofence zone, List<Device> devices) {
  for (final device in devices) {
    if (device.imei == zone.imei) return device;
  }
  return null;
}

SafeZoneCategory categoryFromZoneName(String name) {
  final lower = name.trim().toLowerCase();
  if (lower.contains('school') || lower.contains('college')) {
    return SafeZoneCategory.school;
  }
  if (lower.contains('church') ||
      lower.contains('temple') ||
      lower.contains('mosque')) {
    return SafeZoneCategory.church;
  }
  if (lower.contains('work') ||
      lower.contains('office') ||
      lower.contains('job')) {
    return SafeZoneCategory.work;
  }
  if (lower.contains('hike') ||
      lower.contains('trail') ||
      lower.contains('park')) {
    return SafeZoneCategory.hiking;
  }
  if (lower.contains('home') ||
      lower.contains('house') ||
      lower.contains('grand')) {
    return SafeZoneCategory.home;
  }
  return SafeZoneCategory.other;
}

SafeZoneCategoryStyle styleForCategory(SafeZoneCategory category) {
  switch (category) {
    case SafeZoneCategory.home:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.home,
        label: 'Home',
        color: GuardianColors.accent,
        background: GuardianColors.accentBg,
        icon: Icons.home_outlined,
      );
    case SafeZoneCategory.school:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.school,
        label: 'School',
        color: Color(0xFF7C3AED),
        background: Color(0xFFF3E8FF),
        icon: Icons.school_outlined,
      );
    case SafeZoneCategory.church:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.church,
        label: 'Church',
        color: Color(0xFFEA580C),
        background: Color(0xFFFFEDD5),
        icon: Icons.church_outlined,
      );
    case SafeZoneCategory.work:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.work,
        label: 'Work',
        color: Color(0xFF6B7280),
        background: Color(0xFFF3F4F6),
        icon: Icons.work_outline,
      );
    case SafeZoneCategory.hiking:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.hiking,
        label: 'Hiking',
        color: GuardianColors.safe,
        background: GuardianColors.safeBg,
        icon: Icons.park_outlined,
      );
    case SafeZoneCategory.other:
      return const SafeZoneCategoryStyle(
        category: SafeZoneCategory.other,
        label: 'Zone',
        color: GuardianColors.accent,
        background: GuardianColors.accentBg,
        icon: Icons.place_outlined,
      );
  }
}

SafeZoneCategoryStyle styleForZone(Geofence zone) =>
    styleForCategory(categoryFromZoneName(zone.name));

double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
  const earthRadius = 6371000.0;
  double toRad(double degrees) => degrees * math.pi / 180;
  final dLat = toRad(lat2 - lat1);
  final dLng = toRad(lng2 - lng1);
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(lat1)) *
          math.cos(toRad(lat2)) *
          math.sin(dLng / 2) *
          math.sin(dLng / 2);
  return 2 * earthRadius * math.asin(math.sqrt(a));
}

bool isDeviceInsideZone(Device device, Geofence zone) {
  if (!zone.active) return false;
  if (!device.hasFreshLocation) return false;
  final location = device.location!;
  if (zone.lat == 0 && zone.lng == 0) return false;
  final distance = haversineMeters(
    location.lat,
    location.lng,
    zone.lat,
    zone.lng,
  );
  return distance <= zone.radiusMeters;
}

bool isEmergencyAlert(GuardianAlert alert) {
  if (alert.resolved) return false;
  final type = alert.type.toLowerCase();
  if (type == 'sos' || type == 'fall') return true;
  if (alert.severity.toLowerCase() != 'critical') return false;
  // Prolonged offline (and similar) can be severity "critical" but are not
  // SOS / rescue emergencies — those belong in Attention, not SOS.
  switch (type) {
    case 'offline':
    case 'geofence_enter':
    case 'geofence_exit':
    case 'low_battery':
    case 'stale_gps':
      return false;
    default:
      return true;
  }
}

bool alertMatchesZone(GuardianAlert alert, Geofence zone) {
  if (alert.imei != zone.imei) return false;
  final geofenceId = alert.payload?['geofenceId'] as String?;
  if (geofenceId != null && geofenceId != zone.id) return false;
  return true;
}

GuardianAlert? latestEnterAlert(Geofence zone, List<GuardianAlert> alerts) {
  GuardianAlert? latest;
  for (final alert in alerts) {
    if (!alertMatchesZone(alert, zone)) continue;
    if (alert.type != 'geofence_enter') continue;
    final at = alert.createdAt;
    if (at == null) continue;
    if (latest == null || at.isAfter(latest.createdAt!)) {
      latest = alert;
    }
  }
  return latest;
}

GuardianAlert? latestHeroGeofenceEvent(
  List<Geofence> zones,
  List<GuardianAlert> alerts,
) {
  final zoneIds = zones.map((z) => z.id).toSet();
  GuardianAlert? latest;
  for (final alert in alerts) {
    if (alert.type != 'geofence_enter' && alert.type != 'geofence_exit') {
      continue;
    }
    final geofenceId = alert.payload?['geofenceId'] as String?;
    if (geofenceId != null && !zoneIds.contains(geofenceId)) continue;
    final at = alert.createdAt;
    if (at == null) continue;
    if (latest == null || at.isAfter(latest.createdAt!)) {
      latest = alert;
    }
  }
  return latest;
}

SafeZoneStatus resolveZoneStatus({
  required Geofence zone,
  required Device? device,
  required List<GuardianAlert> alerts,
}) {
  if (!zone.active) return SafeZoneStatus.paused;

  final hasEmergency = alerts.any(
    (alert) => alertMatchesZone(alert, zone) && isEmergencyAlert(alert),
  );
  if (hasEmergency) return SafeZoneStatus.emergency;

  if (device == null) return SafeZoneStatus.unknown;

  if (!device.hasFreshLocation) {
    return SafeZoneStatus.unknown;
  }

  final location = device.location!;
  if (location.lat == 0 && location.lng == 0) {
    return SafeZoneStatus.unknown;
  }

  if (!isDeviceInsideZone(device, zone)) {
    return SafeZoneStatus.outside;
  }

  return SafeZoneStatus.safe;
}

SafeZoneStatusStyle styleForStatus(SafeZoneStatus status) {
  switch (status) {
    case SafeZoneStatus.safe:
      return const SafeZoneStatusStyle(
        status: SafeZoneStatus.safe,
        label: 'SAFE',
        foreground: GuardianColors.safeText,
        background: GuardianColors.safeBg,
      );
    case SafeZoneStatus.outside:
      return const SafeZoneStatusStyle(
        status: SafeZoneStatus.outside,
        label: 'OUTSIDE',
        foreground: GuardianColors.warningText,
        background: GuardianColors.warningBg,
      );
    case SafeZoneStatus.emergency:
      return const SafeZoneStatusStyle(
        status: SafeZoneStatus.emergency,
        label: 'EMERGENCY',
        foreground: GuardianColors.dangerText,
        background: GuardianColors.dangerBg,
      );
    case SafeZoneStatus.paused:
      return const SafeZoneStatusStyle(
        status: SafeZoneStatus.paused,
        label: 'PAUSED',
        foreground: GuardianColors.textSecondary,
        background: Color(0xFFF3F4F6),
      );
    case SafeZoneStatus.unknown:
      return const SafeZoneStatusStyle(
        status: SafeZoneStatus.unknown,
        label: 'NO GPS',
        foreground: GuardianColors.warningText,
        background: GuardianColors.warningBg,
      );
  }
}

SafeZonesHeroSummary buildSafeZonesHeroSummary({
  required List<Geofence> zones,
  required List<Device> devices,
  required List<GuardianAlert> alerts,
  DateTime? now,
}) {
  final activeZones = zones.where((z) => z.active).length;
  final lastEvent = latestHeroGeofenceEvent(zones, alerts);

  if (devices.isEmpty) {
    return SafeZonesHeroSummary(
      activeZoneCount: activeZones,
      totalZoneCount: zones.length,
      headline: 'Link a device to begin',
      detail:
          'Safe zones need a linked watch before they can show live status.',
      tone: SafeZoneStatus.unknown,
      lastEventLabel: lastEvent == null ? null : heroEventLabel(lastEvent),
      lastEventAt: lastEvent?.createdAt,
    );
  }

  if (zones.isEmpty) {
    return SafeZonesHeroSummary(
      activeZoneCount: 0,
      totalZoneCount: 0,
      headline: 'No safe zones yet',
      detail:
          'Create a radius around home, school, or another place you care about.',
      tone: SafeZoneStatus.unknown,
    );
  }

  var outsideCount = 0;
  var emergencyCount = 0;
  var unknownCount = 0;

  for (final zone in zones.where((z) => z.active)) {
    final device = deviceForZone(zone, devices);
    final status = resolveZoneStatus(
      zone: zone,
      device: device,
      alerts: alerts,
    );
    switch (status) {
      case SafeZoneStatus.outside:
        outsideCount++;
      case SafeZoneStatus.emergency:
        emergencyCount++;
      case SafeZoneStatus.unknown:
        unknownCount++;
      case SafeZoneStatus.safe:
      case SafeZoneStatus.paused:
        break;
    }
  }

  if (emergencyCount > 0) {
    return SafeZonesHeroSummary(
      activeZoneCount: activeZones,
      totalZoneCount: zones.length,
      headline: emergencyCount == 1
          ? 'Emergency alert active'
          : '$emergencyCount emergency alerts active',
      detail: 'Check alerts and contact your loved one immediately.',
      tone: SafeZoneStatus.emergency,
      lastEventLabel: lastEvent == null ? null : heroEventLabel(lastEvent),
      lastEventAt: lastEvent?.createdAt,
    );
  }

  if (outsideCount > 0) {
    return SafeZonesHeroSummary(
      activeZoneCount: activeZones,
      totalZoneCount: zones.length,
      headline: outsideCount == 1
          ? '1 wearer outside a safe zone'
          : '$outsideCount wearers outside safe zones',
      detail:
          'Live GPS shows at least one linked device outside its zone radius.',
      tone: SafeZoneStatus.outside,
      lastEventLabel: lastEvent == null ? null : heroEventLabel(lastEvent),
      lastEventAt: lastEvent?.createdAt,
    );
  }

  if (unknownCount > 0 && activeZones > 0) {
    return SafeZonesHeroSummary(
      activeZoneCount: activeZones,
      totalZoneCount: zones.length,
      headline: 'Waiting for fresh GPS',
      detail:
          '$activeZones active zone${activeZones == 1 ? '' : 's'}, but some wearers have no recent location.',
      tone: SafeZoneStatus.unknown,
      lastEventLabel: lastEvent == null ? null : heroEventLabel(lastEvent),
      lastEventAt: lastEvent?.createdAt,
    );
  }

  return SafeZonesHeroSummary(
    activeZoneCount: activeZones,
    totalZoneCount: zones.length,
    headline: 'All clear inside safe zones',
    detail:
        '$activeZones active zone${activeZones == 1 ? '' : 's'} · wearers are inside or zones are paused',
    tone: SafeZoneStatus.safe,
    lastEventLabel: lastEvent == null ? null : heroEventLabel(lastEvent),
    lastEventAt: lastEvent?.createdAt,
  );
}

String heroEventLabel(GuardianAlert alert) {
  if (alert.type == 'geofence_enter') return 'Last enter · ${alert.message}';
  if (alert.type == 'geofence_exit') return 'Last exit · ${alert.message}';
  return alert.message;
}

String lastEnteredLabel(
  Geofence zone,
  List<GuardianAlert> alerts, {
  DateTime? now,
}) {
  final enter = latestEnterAlert(zone, alerts);
  if (enter?.createdAt == null) return 'Last entered · unknown';
  return 'Last entered · ${relativeTimeLabel(enter!.createdAt, now: now)}';
}

String relativeTimeLabel(DateTime? timestamp, {DateTime? now}) {
  if (timestamp == null) return 'unknown';
  final age = (now ?? DateTime.now()).difference(timestamp);
  if (age.inSeconds < 10) return 'just now';
  if (age.inMinutes < 1) return '${age.inSeconds}s ago';
  if (age.inHours < 1) return '${age.inMinutes}m ago';
  if (age.inHours < 48) return '${age.inHours}h ago';
  if (age.inDays < 7) return '${age.inDays}d ago';
  return '${timestamp.day}/${timestamp.month}/${timestamp.year}';
}

String zoneUpdatedLabel(Device? device, {DateTime? now}) {
  if (device == null) return 'No linked device';
  final timestamp =
      device.location?.recordedAt ?? device.updatedAt ?? device.lastHeartbeatAt;
  if (timestamp == null) return 'Update time unavailable';
  return 'Updated ${relativeTimeLabel(timestamp, now: now)}';
}

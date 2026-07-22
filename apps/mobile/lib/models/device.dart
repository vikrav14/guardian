import 'package:cloud_firestore/cloud_firestore.dart';

class DeviceLocation {
  const DeviceLocation({
    required this.lat,
    required this.lng,
    this.altitude,
    this.recordedAt,
    this.satellites,
  });

  final double lat;
  final double lng;
  final double? altitude;
  final DateTime? recordedAt;
  final int? satellites;

  factory DeviceLocation.fromMap(Map<String, dynamic>? map) {
    if (map == null) {
      return const DeviceLocation(lat: 0, lng: 0);
    }
    return DeviceLocation(
      lat: (map['lat'] as num?)?.toDouble() ?? 0,
      lng: (map['lng'] as num?)?.toDouble() ?? 0,
      altitude: (map['altitude'] as num?)?.toDouble(),
      recordedAt: _asDateTime(map['recordedAt']),
      satellites: (map['satellites'] as num?)?.toInt(),
    );
  }

  bool get isValid => lat != 0 || lng != 0;
}

/// Speed above this threshold (km/h) counts as movement for UI labels.
const double deviceMovingSpeedThresholdKmh = 5;

/// Location older than this gap behind the last heartbeat is treated as stale.
const Duration deviceLocationFreshnessSlack = Duration(minutes: 8);

class Device {
  const Device({
    required this.imei,
    required this.online,
    this.name,
    this.nickname,
    this.relationship,
    this.batteryPercent,
    this.speedKmh,
    this.course,
    this.accuracySource,
    this.location,
    this.lastHeartbeatAt,
    this.updatedAt,
    this.simNumber,
    this.avatarUrl,
  });

  final String imei;

  /// Legacy friendly label retained for existing device documents.
  final String? name;
  final String? nickname;
  final String? relationship;
  final bool online;
  final int? batteryPercent;
  final num? speedKmh;
  final num? course;
  final String? accuracySource;
  final DeviceLocation? location;
  final DateTime? lastHeartbeatAt;
  final DateTime? updatedAt;
  final String? simNumber;
  final String? avatarUrl;

  String? get _legacyPersonName {
    final value = name?.trim();
    if (value == null ||
        value.isEmpty ||
        value.toLowerCase().startsWith('device ')) {
      return null;
    }
    final withoutHardware = value.replaceFirst(
      RegExp(r"(?:'s)?\s+(?:pendant|device)$", caseSensitive: false),
      '',
    );
    return withoutHardware.trim().isEmpty ? null : withoutHardware.trim();
  }

  /// Person-first label used throughout Guardian.
  ///
  /// A nickname is most personal, then the guardian's relationship to the
  /// wearer. Existing `name` values remain supported without exposing hardware
  /// wording such as "Mum's pendant".
  String get displayName {
    final preferred = nickname?.trim();
    if (preferred != null && preferred.isNotEmpty) return preferred;
    final relation = relationship?.trim();
    if (relation != null && relation.isNotEmpty) return relation;
    return _legacyPersonName ?? 'Loved one';
  }

  String get relationshipLabel {
    final relation = relationship?.trim();
    if (relation != null && relation.isNotEmpty) return relation;
    return _legacyPersonName ?? 'Family member';
  }

  /// True when [location] has coordinates and was recorded near the last contact.
  ///
  /// Prevents simulator or old GPS writes from showing a map pin after the real
  /// device reconnects with heartbeats only (no fresh fix yet).
  bool get hasFreshLocation {
    final loc = location;
    if (loc == null || !loc.isValid) return false;
    final recorded = loc.recordedAt;
    if (recorded == null) return false;
    final contact = lastHeartbeatAt ?? updatedAt;
    if (contact != null &&
        contact.difference(recorded) > deviceLocationFreshnessSlack) {
      return false;
    }
    return true;
  }

  bool get isMoving =>
      hasFreshLocation && (speedKmh ?? 0) > deviceMovingSpeedThresholdKmh;

  factory Device.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return Device(
      imei: doc.id,
      name: data['name'] as String?,
      nickname: data['nickname'] as String?,
      relationship: data['relationship'] as String?,
      online: data['online'] == true,
      batteryPercent: (data['batteryPercent'] as num?)?.toInt(),
      speedKmh: data['speedKmh'] as num?,
      course: data['course'] as num?,
      accuracySource: data['accuracySource'] as String?,
      location: DeviceLocation.fromMap(
        data['location'] is Map
            ? Map<String, dynamic>.from(data['location'] as Map)
            : null,
      ),
      lastHeartbeatAt: _asDateTime(data['lastHeartbeatAt']),
      updatedAt: _asDateTime(data['updatedAt']),
      simNumber: data['simNumber'] as String?,
      avatarUrl: data['avatarUrl'] as String?,
    );
  }
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

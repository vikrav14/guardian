import 'package:cloud_firestore/cloud_firestore.dart';
import 'home_wifi_presence.dart';

class DeviceLocation {
  const DeviceLocation({
    required this.lat,
    required this.lng,
    this.altitude,
    this.recordedAt,
    this.satellites,
    this.placeLabel,
    this.source,
    this.gpsValid,
    this.accuracyMeters,
  });

  final double lat;
  final double lng;
  final double? altitude;
  final DateTime? recordedAt;
  final int? satellites;
  final String? placeLabel;
  final String? source;
  final bool? gpsValid;
  final double? accuracyMeters;

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
      placeLabel: (map['placeLabel'] as String?)?.trim(),
      source: (map['source'] as String?)?.trim().toLowerCase(),
      gpsValid: map['gpsValid'] as bool?,
      accuracyMeters: (map['accuracyMeters'] as num?)?.toDouble(),
    );
  }

  bool get isValid => lat != 0 || lng != 0;
}

/// Speed above this threshold (km/h) counts as movement for UI labels.
const double deviceMovingSpeedThresholdKmh = 5;

/// Location older than this gap behind the last heartbeat is treated as stale.
const Duration deviceLocationFreshnessSlack = Duration(minutes: 8);

/// Last Firestore contact older than this is not treated as live, even if `online: true`.
/// Must exceed the gateway write-gate heartbeat interval and normal quiet gaps
/// (stationary pendants often go several minutes between packets).
const Duration deviceLiveContactThreshold = Duration(minutes: 12);

class DevicePositioningDescription {
  const DevicePositioningDescription({
    required this.label,
    required this.approximate,
  });

  final String label;
  final bool approximate;
}

class DeviceIntelligence {
  const DeviceIntelligence({
    required this.insights,
    this.topInsight,
    this.updatedAt,
  });

  final List<DeviceIntelligenceInsight> insights;
  final DeviceIntelligenceInsight? topInsight;
  final DateTime? updatedAt;

  factory DeviceIntelligence.fromMap(Map<String, dynamic>? map) {
    if (map == null) {
      return const DeviceIntelligence(insights: []);
    }
    final rawInsights = map['insights'];
    final insights = rawInsights is List
        ? rawInsights
              .whereType<Map>()
              .map(
                (item) => DeviceIntelligenceInsight.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
        : const <DeviceIntelligenceInsight>[];

    final topRaw = map['topInsight'];
    final topInsight = topRaw is Map
        ? DeviceIntelligenceInsight.fromMap(Map<String, dynamic>.from(topRaw))
        : (insights.isNotEmpty ? insights.first : null);

    return DeviceIntelligence(
      insights: insights,
      topInsight: topInsight,
      updatedAt: _asDateTime(map['updatedAt']),
    );
  }
}

class DeviceIntelligenceInsight {
  const DeviceIntelligenceInsight({
    required this.id,
    required this.inference,
    required this.confidence,
    required this.level,
    this.suppressBelow = 50,
  });

  final String id;
  final String inference;
  final int confidence;
  final String level;
  final int suppressBelow;

  factory DeviceIntelligenceInsight.fromMap(Map<String, dynamic> map) {
    return DeviceIntelligenceInsight(
      id: map['id'] as String? ?? 'unknown',
      inference: map['inference'] as String? ?? '',
      confidence: (map['confidence'] as num?)?.round() ?? 0,
      level: map['level'] as String? ?? 'info',
      suppressBelow: (map['suppressBelow'] as num?)?.round() ?? 50,
    );
  }
}

class Device {
  const Device({
    required this.imei,
    required this.online,
    this.name,
    this.nickname,
    this.relationship,
    this.batteryPercent,
    this.batteryUpdatedAt,
    this.cellularSignalPercent,
    this.cellularSignalUpdatedAt,
    this.stepsRaw,
    this.rollCountRaw,
    this.activityUpdatedAt,
    this.telemetryUpdatedAt,
    this.speedKmh,
    this.course,
    this.accuracySource,
    this.location,
    this.lastLocationObservation,
    this.lastSatelliteLocation,
    this.lastApproximateLocation,
    this.homeWifiPresence,
    this.lastHeartbeatAt,
    this.disconnectedAt,
    this.connectionState,
    this.connectingAt,
    this.updatedAt,
    this.simNumber,
    this.avatarUrl,
    this.intelligence,
    this.fallDetectionEnabled,
    this.fallDetectionDialMonitor,
    this.fallDetectionSensitivity,
    this.locationReportingIntervalSeconds,
    this.locationReportingMode = 'automatic',
    this.careProfile,
    this.carePriorities = const <String>[],
    this.capabilities = const <String>[],
  });

  final String imei;

  /// Legacy friendly label retained for existing device documents.
  final String? name;
  final String? nickname;
  final String? relationship;
  final bool online;
  final int? batteryPercent;
  final DateTime? batteryUpdatedAt;

  /// Latest V52 cellular signal value (0-100), not inferred from connectivity.
  final int? cellularSignalPercent;
  final DateTime? cellularSignalUpdatedAt;

  /// Raw V52 counters. Their reset/day semantics are not yet accepted, so the
  /// app must not present them as daily activity totals.
  final int? stepsRaw;
  final int? rollCountRaw;
  final DateTime? activityUpdatedAt;
  final DateTime? telemetryUpdatedAt;
  final num? speedKmh;
  final num? course;
  final String? accuracySource;
  final DeviceLocation? location;
  final DeviceLocation? lastLocationObservation;
  final DeviceLocation? lastSatelliteLocation;
  final DeviceLocation? lastApproximateLocation;
  final HomeWifiPresence? homeWifiPresence;

  DeviceLocation? homeWifiLocationAt(DateTime now) {
    final home = homeWifiPresence;
    if (home == null || !home.isFreshAt(now)) return null;
    final fixes = [lastSatelliteLocation, lastLocationObservation, location];
    for (var index = 0; index < fixes.length; index++) {
      final fix = fixes[index];
      if (fix == null || fix.gpsValid == false) continue;
      final gps = index == 0 || fix.source == 'gps' ||
          (index == 2 && accuracySource == 'gps');
      final at = fix.recordedAt;
      if (gps && at != null && !at.isBefore(home.observedAt)) return null;
    }
    return DeviceLocation(lat: home.lat, lng: home.lng,
      recordedAt: home.observedAt, source: 'home_wifi',
      gpsValid: false, placeLabel: 'Home');
  }

  bool get hasHomeWifiDisplay => homeWifiLocationAt(DateTime.now()) != null;
  final DateTime? lastHeartbeatAt;
  final DateTime? disconnectedAt;

  /// Gateway connection phase: `live`, `connecting`, or `offline`.
  final String? connectionState;
  final DateTime? connectingAt;
  final DateTime? updatedAt;
  final String? simNumber;
  final String? avatarUrl;
  final DeviceIntelligence? intelligence;

  /// Last V52 preference the app asked the watch for.
  /// The device has no "read back my fall-detection config" command, so
  /// this is a cache of the last request, not confirmed device state.
  final bool? fallDetectionEnabled;
  final bool? fallDetectionDialMonitor;
  final int? fallDetectionSensitivity;

  /// Last upload interval the app asked the watch for, in seconds --
  /// V52 only. Same "request cache, not confirmed state" caveat as
  /// the fall detection fields above; there's no read-back command.
  final int? locationReportingIntervalSeconds;
  final String locationReportingMode;

  /// Person context used by Guardian Intelligence. Never hard-code by IMEI.
  final String? careProfile;
  final List<String> carePriorities;

  /// Hardware features this watch can provide. Kept separate from care intent.
  final List<String> capabilities;

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

  /// Gateway says connected and we heard from the watch recently.
  bool get hasRecentContact {
    final contact = lastHeartbeatAt ?? updatedAt;
    if (contact == null) return false;
    return DateTime.now().difference(contact) <= deviceLiveContactThreshold;
  }

  bool get isLiveConnected => online && hasRecentContact;

  DeviceLocation? get latestLocationObservation {
    final observation = lastLocationObservation;
    if (observation?.isValid == true) return observation;
    return location?.isValid == true ? location : null;
  }

  String? get latestLocationSource {
    final source = latestLocationObservation?.source ?? accuracySource;
    return source?.trim().toLowerCase();
  }

  bool get isDisplayingRetainedSatelliteLocation {
    final latest = latestLocationObservation;
    final satellite = lastSatelliteLocation;
    if (latest?.isValid != true || satellite?.isValid != true) return false;
    final source = latestLocationSource;
    return source == 'wifi' || source == 'lbs';
  }

  DeviceLocation? get displayLocation {
    if (isDisplayingRetainedSatelliteLocation) return lastSatelliteLocation;
    return latestLocationObservation ?? lastSatelliteLocation;
  }

  /// Conservative map position for a family-facing live view.
  ///
  /// WiFi/LBS observations can be useful evidence but are too broad to move a
  /// person's primary avatar. A fresh, backend-validated Home radio match can
  /// temporarily select the saved Home pin with its own source/time label.
  /// Otherwise the accepted satellite/network fallback applies. This overlay
  /// never changes stored telemetry, journeys, geofences or SOS selection.
  DeviceLocation? get mapDisplayLocation => mapDisplayLocationAt(DateTime.now());

  DeviceLocation? mapDisplayLocationAt(DateTime now) {
    final home = homeWifiLocationAt(now);
    if (home != null) return home;
    final source = latestLocationSource;
    final satellite = lastSatelliteLocation;
    if ((source == 'wifi' || source == 'lbs') && satellite?.isValid == true) {
      return satellite;
    }
    return displayLocation;
  }

  bool get isMapDisplayingLastSatelliteLocation {
    if (hasHomeWifiDisplay) return false;
    final source = latestLocationSource;
    return (source == 'wifi' || source == 'lbs') &&
        lastSatelliteLocation?.isValid == true;
  }

  String? get displayLocationSource =>
      isDisplayingRetainedSatelliteLocation ? 'gps' : latestLocationSource;

  /// True when [location] has coordinates and was recorded near the last contact.
  ///
  /// Prevents simulator or old GPS writes from showing a map pin after the real
  /// device reconnects with heartbeats only (no fresh fix yet). Once the
  /// watch goes offline this check is skipped entirely -- an offline device
  /// will never send a newer heartbeat to "catch up" to, so the last known
  /// fix should keep showing (faded) rather than disappear once it crosses
  /// the slack window.
  bool get hasFreshLocation {
    final loc = latestLocationObservation;
    if (loc == null || !loc.isValid) return false;
    final recorded = loc.recordedAt;
    if (recorded == null) return false;
    if (!online) return true;
    final contact = lastHeartbeatAt ?? updatedAt;
    if (contact != null &&
        contact.difference(recorded) > deviceLocationFreshnessSlack) {
      return false;
    }
    return true;
  }

  /// True when the latest fix came from WiFi/cell geolocation (gps=V), not satellite GPS.
  bool get hasApproximateLocation {
    if (!hasFreshLocation) return false;
    final source = latestLocationSource;
    return source == 'wifi' || source == 'lbs';
  }

  /// Human-readable fix type for Guardian AI and map labels.
  DevicePositioningDescription? get positioningDescription {
    final source = displayLocationSource;
    return switch (source) {
      'gps' => const DevicePositioningDescription(
        label: 'satellite GPS',
        approximate: false,
      ),
      'wifi' => const DevicePositioningDescription(
        label: 'WiFi positioning',
        approximate: true,
      ),
      'lbs' => const DevicePositioningDescription(
        label: 'cell tower positioning',
        approximate: true,
      ),
      _ => null,
    };
  }

  bool get isMoving =>
      hasFreshLocation && (speedKmh ?? 0) > deviceMovingSpeedThresholdKmh;

  /// Gateway [stale_gps] intelligence insight is active above its threshold.
  bool get hasActiveStaleGpsInsight {
    final intelligence = this.intelligence;
    if (intelligence == null) return false;
    bool isActive(DeviceIntelligenceInsight insight) =>
        insight.id == 'stale_gps' &&
        insight.confidence >= insight.suppressBelow;
    final top = intelligence.topInsight;
    if (top != null && isActive(top)) return true;
    return intelligence.insights.any(isActive);
  }

  factory Device.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return Device(
      imei: doc.id,
      name: data['name'] as String?,
      nickname: data['nickname'] as String?,
      relationship: data['relationship'] as String?,
      online: data['online'] == true,
      batteryPercent: (data['batteryPercent'] as num?)?.toInt(),
      batteryUpdatedAt: _asDateTime(data['batteryUpdatedAt']),
      cellularSignalPercent: (data['cellularSignalPercent'] as num?)?.toInt(),
      cellularSignalUpdatedAt: _asDateTime(data['cellularSignalUpdatedAt']),
      stepsRaw: (data['stepsRaw'] as num?)?.toInt(),
      rollCountRaw: (data['rollCountRaw'] as num?)?.toInt(),
      activityUpdatedAt: _asDateTime(data['activityUpdatedAt']),
      telemetryUpdatedAt: _asDateTime(data['telemetryUpdatedAt']),
      speedKmh: data['speedKmh'] as num?,
      course: data['course'] as num?,
      accuracySource: data['accuracySource'] as String?,
      location: DeviceLocation.fromMap(
        data['location'] is Map
            ? Map<String, dynamic>.from(data['location'] as Map)
            : null,
      ),
      lastLocationObservation: DeviceLocation.fromMap(
        data['lastLocationObservation'] is Map
            ? Map<String, dynamic>.from(data['lastLocationObservation'] as Map)
            : null,
      ),
      lastSatelliteLocation: DeviceLocation.fromMap(
        data['lastSatelliteLocation'] is Map
            ? Map<String, dynamic>.from(data['lastSatelliteLocation'] as Map)
            : null,
      ),
      lastApproximateLocation: DeviceLocation.fromMap(
        data['lastApproximateLocation'] is Map
            ? Map<String, dynamic>.from(data['lastApproximateLocation'] as Map)
            : null,
      ),
      homeWifiPresence: HomeWifiPresence.fromMap(
        data['homeWifiPresence'] is Map
            ? Map<String, dynamic>.from(data['homeWifiPresence'] as Map)
            : null,
      ),
      lastHeartbeatAt: _asDateTime(data['lastHeartbeatAt']),
      disconnectedAt: _asDateTime(data['disconnectedAt']),
      connectionState: data['connectionState'] as String?,
      connectingAt: _asDateTime(data['connectingAt']),
      updatedAt: _asDateTime(data['updatedAt']),
      simNumber: data['simNumber'] as String?,
      avatarUrl: data['avatarUrl'] as String?,
      intelligence: DeviceIntelligence.fromMap(
        data['intelligence'] is Map
            ? Map<String, dynamic>.from(data['intelligence'] as Map)
            : null,
      ),
      fallDetectionEnabled:
          (data['fallDetection'] as Map?)?['enabled'] as bool?,
      fallDetectionDialMonitor:
          (data['fallDetection'] as Map?)?['dialMonitorOnFall'] as bool?,
      fallDetectionSensitivity:
          ((data['fallDetection'] as Map?)?['sensitivityLevel'] as num?)
              ?.toInt(),
      locationReportingIntervalSeconds:
          (data['locationReportingIntervalSeconds'] as num?)?.toInt(),
      careProfile: data['careProfile'] as String?,
      carePriorities:
          (data['carePriorities'] as List?)?.whereType<String>().toList(
            growable: false,
          ) ??
          const <String>[],
      capabilities:
          (data['capabilities'] as List?)?.whereType<String>().toList(
            growable: false,
          ) ??
          const <String>[],
    );
  }
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

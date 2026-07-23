import 'dart:math' as math;

import 'package:intl/intl.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../safe_zones/safe_zone_logic.dart';
import 'journey_models.dart';

const _earthRadiusM = 6371000.0;
const stoppedSpeedKmh = 1.0;
const walkingSpeedKmh = 6.0;
const bicycleSpeedKmh = 20.0;
const runningMinSpeedKmh = 10.0;
const runningMaxSpeedKmh = 25.0;
const runningMaxDuration = Duration(minutes: 3);
const _minStoppedPoints = 3;

/// Total path length in kilometres from consecutive GPS points.
double journeyDistanceKm(List<LocationHistoryPoint> points) {
  if (points.length < 2) return 0;
  var meters = 0.0;
  for (var i = 1; i < points.length; i++) {
    final a = points[i - 1];
    final b = points[i];
    meters += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return meters / 1000.0;
}

Duration journeyDuration(List<LocationHistoryPoint> points) {
  if (points.isEmpty) return Duration.zero;
  final first = points.first.recordedAt;
  final last = points.last.recordedAt;
  if (first == null || last == null) return Duration.zero;
  final delta = last.difference(first);
  return delta.isNegative ? Duration.zero : delta;
}

JourneyStats buildJourneyStats(List<LocationHistoryPoint> points) {
  return JourneyStats(
    pointCount: points.length,
    distanceKm: journeyDistanceKm(points),
    duration: journeyDuration(points),
    startTime: points.firstOrNull?.recordedAt,
    endTime: points.lastOrNull?.recordedAt,
  );
}

/// Smooths a route for map display while keeping the raw history untouched.
List<LocationHistoryPoint> smoothRouteForDisplay(
  List<LocationHistoryPoint> points, {
  double epsilonMeters = 8.0,
}) {
  if (points.length <= 2) return List<LocationHistoryPoint>.from(points);
  final indices = _douglasPeuckerIndices(points, 0, points.length - 1, epsilonMeters);
  indices.sort();
  return indices.map((i) => points[i]).toList(growable: false);
}

List<int> _douglasPeuckerIndices(
  List<LocationHistoryPoint> points,
  int start,
  int end,
  double epsilonMeters,
) {
  if (end <= start + 1) return [start, end];

  var maxDistance = 0.0;
  var maxIndex = start;
  for (var i = start + 1; i < end; i++) {
    final distance = _perpendicularDistanceMeters(
      points[i],
      points[start],
      points[end],
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > epsilonMeters) {
    final left = _douglasPeuckerIndices(points, start, maxIndex, epsilonMeters);
    final right = _douglasPeuckerIndices(points, maxIndex, end, epsilonMeters);
    return [...left.sublist(0, left.length - 1), ...right];
  }
  return [start, end];
}

double _perpendicularDistanceMeters(
  LocationHistoryPoint point,
  LocationHistoryPoint lineStart,
  LocationHistoryPoint lineEnd,
) {
  final latScale = _earthRadiusM * math.pi / 180;
  final lngScale = latScale * math.cos(lineStart.lat * math.pi / 180);

  final x = (point.lng - lineStart.lng) * lngScale;
  final y = (point.lat - lineStart.lat) * latScale;
  final x2 = (lineEnd.lng - lineStart.lng) * lngScale;
  final y2 = (lineEnd.lat - lineStart.lat) * latScale;

  final lenSq = x2 * x2 + y2 * y2;
  if (lenSq == 0) {
    return math.sqrt(x * x + y * y);
  }

  final t = ((x * x2) + (y * y2)) / lenSq;
  final clamped = t.clamp(0.0, 1.0);
  final projX = clamped * x2;
  final projY = clamped * y2;
  final dx = x - projX;
  final dy = y - projY;
  return math.sqrt(dx * dx + dy * dy);
}

double? effectiveSpeedKmh(LocationHistoryPoint from, LocationHistoryPoint to) {
  if (from.speedKmh != null) return from.speedKmh!.toDouble();
  final t1 = from.recordedAt;
  final t2 = to.recordedAt;
  if (t1 == null || t2 == null) return null;
  final hours = t2.difference(t1).inMilliseconds / 3600000.0;
  if (hours <= 0) return null;
  final meters = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return (meters / 1000.0) / hours;
}

TransportMode classifyTransportMode(double? speedKmh) {
  if (speedKmh == null) return TransportMode.walking;
  if (speedKmh < stoppedSpeedKmh) return TransportMode.stationary;
  if (speedKmh < walkingSpeedKmh) return TransportMode.walking;
  if (speedKmh < bicycleSpeedKmh) return TransportMode.bicycle;
  return TransportMode.vehicle;
}

RouteSegmentColor routeColorForSpeed(double? speedKmh) {
  if (speedKmh == null || speedKmh < stoppedSpeedKmh) {
    return RouteSegmentColor.purple;
  }
  if (speedKmh < walkingSpeedKmh) return RouteSegmentColor.green;
  return RouteSegmentColor.blue;
}

bool isRunningSegment(List<LocationHistoryPoint> points, int start, int end) {
  if (end <= start) return false;
  final startTime = points[start].recordedAt;
  final endTime = points[end].recordedAt;
  if (startTime == null || endTime == null) return false;
  if (endTime.difference(startTime) > runningMaxDuration) return false;

  var totalSpeed = 0.0;
  var count = 0;
  for (var i = start + 1; i <= end; i++) {
    final speed = effectiveSpeedKmh(points[i - 1], points[i]);
    if (speed == null) continue;
    totalSpeed += speed;
    count++;
  }
  if (count == 0) return false;
  final avg = totalSpeed / count;
  return avg >= runningMinSpeedKmh && avg < runningMaxSpeedKmh;
}

TransportMode transportModeForSegment(
  List<LocationHistoryPoint> points,
  int start,
  int end,
) {
  var totalSpeed = 0.0;
  var count = 0;
  for (var i = start + 1; i <= end; i++) {
    final speed = effectiveSpeedKmh(points[i - 1], points[i]);
    if (speed == null) continue;
    totalSpeed += speed;
    count++;
  }
  if (count == 0) return TransportMode.walking;
  final avg = totalSpeed / count;
  final base = classifyTransportMode(avg);
  if (base == TransportMode.bicycle && isRunningSegment(points, start, end)) {
    return TransportMode.running;
  }
  return base;
}

JourneyEventType eventTypeForTransport(TransportMode mode) {
  return switch (mode) {
    TransportMode.stationary => JourneyEventType.stopped,
    TransportMode.walking ||
    TransportMode.bicycle ||
    TransportMode.running =>
      JourneyEventType.walking,
    TransportMode.vehicle => JourneyEventType.vehicle,
  };
}

String labelForTransportMode(TransportMode mode) {
  return switch (mode) {
    TransportMode.stationary => 'Stop',
    TransportMode.walking => 'Walking',
    TransportMode.bicycle => 'Cycling',
    TransportMode.running => 'Running',
    TransportMode.vehicle => 'Vehicle',
  };
}

String labelForEventType(JourneyEventType type) {
  return switch (type) {
    JourneyEventType.leftHome => 'Left Home',
    JourneyEventType.walking => 'Walking',
    JourneyEventType.vehicle => 'Vehicle',
    JourneyEventType.stopped => 'Stop',
    JourneyEventType.arrived => 'Arrived',
    JourneyEventType.dwell => 'Stayed',
  };
}

String emojiForEventType(JourneyEventType type) {
  return switch (type) {
    JourneyEventType.leftHome => '🏠',
    JourneyEventType.walking => '🚶',
    JourneyEventType.vehicle => '🚌',
    JourneyEventType.stopped => '⏸',
    JourneyEventType.arrived => '🏁',
    JourneyEventType.dwell => '📍',
  };
}

/// Back-compat alias used by older tests/callers.
JourneyEventType classifySegmentSpeed(double? speedKmh) {
  return eventTypeForTransport(classifyTransportMode(speedKmh));
}

List<RouteSegment> buildRouteSegments(List<LocationHistoryPoint> points) {
  if (points.length < 2) return const [];

  final segments = <RouteSegment>[];
  var segmentStart = 0;
  var currentColor = routeColorForSpeed(
    effectiveSpeedKmh(points[0], points[1]),
  );

  for (var i = 1; i < points.length; i++) {
    final speed = effectiveSpeedKmh(points[i - 1], points[i]);
    final color = routeColorForSpeed(speed);
    final isLast = i == points.length - 1;
    if (color != currentColor || isLast) {
      final endIndex = isLast && color == currentColor ? i : i - 1;
      if (endIndex >= segmentStart) {
        segments.add(
          RouteSegment(
            startIndex: segmentStart,
            endIndex: endIndex,
            mode: transportModeForSegment(points, segmentStart, endIndex),
            color: currentColor,
          ),
        );
      }
      if (!isLast || color != currentColor) {
        segmentStart = isLast && color != currentColor ? i : i - 1;
        currentColor = color;
        if (isLast && color != currentColor) {
          segments.add(
            RouteSegment(
              startIndex: segmentStart,
              endIndex: i,
              mode: transportModeForSegment(points, segmentStart, i),
              color: currentColor,
            ),
          );
        }
      }
    }
  }
  return segments;
}

Geofence? resolveHomeGeofence(List<Geofence> geofences) {
  final active = geofences.where((zone) => zone.active).toList();
  if (active.isEmpty) return null;

  for (final zone in active) {
    if (zone.name.toLowerCase().contains('home')) return zone;
  }
  return active.length == 1 ? active.first : null;
}

bool isPointInsideGeofence(LocationHistoryPoint point, Geofence zone) {
  if (!zone.active) return false;
  if (zone.lat == 0 && zone.lng == 0) return false;
  final distance = haversineMeters(point.lat, point.lng, zone.lat, zone.lng);
  return distance <= zone.radiusMeters;
}

String labelForArrivalEvent({required bool arrivedHome, String? zoneName}) {
  if (arrivedHome) {
    final name = zoneName?.trim();
    return name != null && name.isNotEmpty ? 'Arrived $name' : 'Arrived Home';
  }
  return labelForEventType(JourneyEventType.arrived);
}

/// Infers movement segments from speed (device-reported or computed).
List<JourneyEvent> detectJourneyEvents(
  List<LocationHistoryPoint> points, {
  List<Geofence> geofences = const [],
}) {
  if (points.isEmpty) return const [];

  final home = resolveHomeGeofence(geofences);
  final events = <JourneyEvent>[];
  bool? wasInsideHome;

  if (home != null) {
    wasInsideHome = isPointInsideGeofence(points.first, home);
  }

  if (points.length == 1) {
    if (home != null && wasInsideHome == true) {
      events.add(
        JourneyEvent(
          type: JourneyEventType.arrived,
          label: labelForArrivalEvent(arrivedHome: true, zoneName: home.name),
          startIndex: 0,
          endIndex: 0,
          at: points.first.recordedAt,
          transportMode: TransportMode.stationary,
        ),
      );
    } else {
      events.add(
        JourneyEvent(
          type: JourneyEventType.arrived,
          label: labelForEventType(JourneyEventType.arrived),
          startIndex: 0,
          endIndex: 0,
          at: points.first.recordedAt,
          transportMode: TransportMode.stationary,
        ),
      );
    }
    return events;
  }

  var index = 1;
  var terminalArrivalAdded = false;
  while (index < points.length) {
    if (home != null) {
      final inside = isPointInsideGeofence(points[index], home);
      if (wasInsideHome == true && !inside) {
        events.add(
          JourneyEvent(
            type: JourneyEventType.leftHome,
            label: labelForEventType(JourneyEventType.leftHome),
            startIndex: index,
            endIndex: index,
            at: points[index].recordedAt,
            transportMode: TransportMode.stationary,
          ),
        );
      } else if (wasInsideHome == false && inside) {
        events.add(
          JourneyEvent(
            type: JourneyEventType.arrived,
            label: labelForArrivalEvent(arrivedHome: true, zoneName: home.name),
            startIndex: index,
            endIndex: index,
            at: points[index].recordedAt,
            transportMode: TransportMode.stationary,
          ),
        );
        if (index == points.length - 1) {
          terminalArrivalAdded = true;
        }
      }
      wasInsideHome = inside;
    }

    final mode = transportModeForSegment(points, index - 1, index);
    final type = eventTypeForTransport(mode);

    if (type == JourneyEventType.stopped) {
      var stoppedCount = 1;
      var end = index - 1;
      var probe = index;
      while (probe < points.length) {
        final probeMode = transportModeForSegment(points, probe - 1, probe);
        if (eventTypeForTransport(probeMode) != JourneyEventType.stopped) {
          break;
        }
        stoppedCount++;
        end = probe;
        probe++;
      }
      if (stoppedCount >= _minStoppedPoints) {
        events.add(
          JourneyEvent(
            type: JourneyEventType.stopped,
            label: labelForEventType(JourneyEventType.stopped),
            startIndex: index - 1,
            endIndex: end,
            at: points[index - 1].recordedAt,
            transportMode: TransportMode.stationary,
          ),
        );
        index = end + 1;
        continue;
      }
    }

    final segmentStart = index - 1;
    var segmentEnd = index - 1;
    var segmentMode = mode;
    while (index < points.length) {
      final nextMode = transportModeForSegment(points, index - 1, index);
      final nextType = eventTypeForTransport(nextMode);
      if (nextType == JourneyEventType.stopped) break;
      if (nextMode != segmentMode) break;
      segmentEnd = index;
      index++;
    }

    if (segmentEnd > segmentStart) {
      final resolvedMode = transportModeForSegment(
        points,
        segmentStart,
        segmentEnd,
      );
      events.add(
        JourneyEvent(
          type: eventTypeForTransport(resolvedMode),
          label: labelForTransportMode(resolvedMode),
          startIndex: segmentStart,
          endIndex: segmentEnd,
          at: points[segmentStart].recordedAt,
          transportMode: resolvedMode,
        ),
      );
    } else {
      index++;
    }
  }

  final lastIndex = points.length - 1;
  final endedInsideHome =
      home != null && isPointInsideGeofence(points[lastIndex], home);

  if (!terminalArrivalAdded) {
    events.add(
      JourneyEvent(
        type: JourneyEventType.arrived,
        label: endedInsideHome
            ? labelForArrivalEvent(arrivedHome: true, zoneName: home.name)
            : labelForEventType(JourneyEventType.arrived),
        startIndex: lastIndex,
        endIndex: lastIndex,
        at: points[lastIndex].recordedAt,
        transportMode: TransportMode.stationary,
      ),
    );
  }

  return events;
}

double _approximateRatio(List<LocationHistoryPoint> points) {
  final sources = points
      .map((p) => p.accuracySource?.toLowerCase())
      .whereType<String>()
      .where((s) => s.isNotEmpty)
      .toList();
  if (sources.isEmpty) return 0;
  return sources.where((s) => s == 'wifi' || s == 'lbs').length / sources.length;
}

double _gpsRatio(List<LocationHistoryPoint> points) {
  final gpsSources = points
      .map((p) => p.accuracySource?.toLowerCase())
      .whereType<String>()
      .where((s) => s.isNotEmpty)
      .toList();
  if (gpsSources.isEmpty) return 0;
  return gpsSources.where((s) => s.contains('gps')).length / gpsSources.length;
}

double _accuracyMetadataCoverage(List<LocationHistoryPoint> points) {
  if (points.isEmpty) return 0;
  final withMeta = points
      .where((p) => p.accuracySource?.trim().isNotEmpty == true)
      .length;
  return withMeta / points.length;
}

bool _hasFrozenCoordinates(List<LocationHistoryPoint> points) {
  if (points.length < 3) return false;
  final first = points.first;
  final identical = points
      .where(
        (p) =>
            (p.lat - first.lat).abs() < 0.00001 &&
            (p.lng - first.lng).abs() < 0.00001,
      )
      .length;
  return identical >= (points.length * 0.9).ceil();
}

class JourneyGpsAssessment {
  const JourneyGpsAssessment({
    required this.metadataCoverage,
    required this.gpsRatio,
    required this.approximateRatio,
    required this.frozenCoordinates,
    required this.liveGpsUnreliable,
    required this.warningMessage,
  });

  final double metadataCoverage;
  final double gpsRatio;
  final double approximateRatio;
  final bool frozenCoordinates;
  final bool liveGpsUnreliable;
  final String? warningMessage;

  bool get metadataMissing => metadataCoverage < 0.5;
  bool get gpsQualityPoor =>
      metadataCoverage > 0 && (gpsRatio < 0.4 || approximateRatio > 0.5);

  bool get shouldCapConfidence =>
      liveGpsUnreliable || metadataMissing || gpsQualityPoor || frozenCoordinates;
}

JourneyGpsContext journeyGpsContextForDevice(
  Device? device, {
  required bool isViewingToday,
}) {
  if (device == null) {
    return JourneyGpsContext(isViewingToday: isViewingToday);
  }
  return JourneyGpsContext(
    liveGpsFresh: device.hasFreshLocation && !device.hasApproximateLocation,
    liveApproximateFix: device.hasApproximateLocation,
    staleGpsActive: device.hasActiveStaleGpsInsight,
    isViewingToday: isViewingToday,
  );
}

JourneyGpsAssessment assessJourneyGps(
  List<LocationHistoryPoint> points, {
  JourneyGpsContext? gpsContext,
}) {
  final metadataCoverage = _accuracyMetadataCoverage(points);
  final gpsRatio = _gpsRatio(points);
  final approximateRatio = _approximateRatio(points);
  final frozen = _hasFrozenCoordinates(points);

  var liveUnreliable = false;
  String? warning;

  final context = gpsContext;
  if (context != null && context.isViewingToday) {
    if (context.staleGpsActive) {
      liveUnreliable = true;
      warning = 'GPS unavailable — journey data may be incomplete';
    } else if (!context.liveGpsFresh && !context.liveApproximateFix) {
      liveUnreliable = true;
      warning = 'GPS unavailable — journey data may be incomplete';
    }
  }

  if (frozen && (liveUnreliable || context?.isViewingToday == true)) {
    warning ??= 'GPS unavailable — journey data may be incomplete';
  }

  if (metadataCoverage < 0.5) {
    warning ??= 'GPS metadata unavailable for this route';
  } else if (approximateRatio > 0.5) {
    warning ??= 'Route uses approximate WiFi/cell positioning';
  } else if (gpsRatio < 0.4) {
    warning ??= 'Unable to determine with confidence';
  }

  return JourneyGpsAssessment(
    metadataCoverage: metadataCoverage,
    gpsRatio: gpsRatio,
    approximateRatio: approximateRatio,
    frozenCoordinates: frozen,
    liveGpsUnreliable: liveUnreliable,
    warningMessage: warning,
  );
}

String _gpsQualityLabel(JourneyQuality quality, JourneyGpsAssessment assessment) {
  if (assessment.liveGpsUnreliable) {
    return 'GPS unavailable';
  }
  if (assessment.metadataMissing) {
    return 'GPS quality unknown';
  }
  if (assessment.approximateRatio > 0.5) {
    return 'Approximate positioning';
  }
  if (assessment.frozenCoordinates && assessment.gpsQualityPoor) {
    return 'Poor GPS coverage';
  }
  return switch (quality.label) {
    'Unknown' => 'GPS quality unknown',
    'Excellent' => 'Excellent GPS coverage',
    'Good' => 'Good GPS coverage',
    _ => 'Fair GPS coverage',
  };
}

String _gpsHealthPhrase(JourneyQuality quality, JourneyGpsAssessment assessment) {
  if (assessment.shouldCapConfidence) {
    return 'GPS unreliable';
  }
  return switch (quality.label) {
    'Excellent' => 'excellent GPS',
    'Good' => 'good GPS',
    _ => 'fair GPS',
  };
}

JourneyQuality computeJourneyQuality(
  List<LocationHistoryPoint> points, {
  JourneyGpsContext? gpsContext,
}) {
  if (points.isEmpty) {
    return const JourneyQuality(fixCount: 0, label: 'Unknown');
  }

  final assessment = assessJourneyGps(points, gpsContext: gpsContext);
  if (assessment.shouldCapConfidence) {
    return JourneyQuality(
      fixCount: points.length,
      label: assessment.metadataMissing ? 'Unknown' : 'Fair',
    );
  }

  final stats = buildJourneyStats(points);
  final durationHours =
      stats.duration.inHours + (stats.duration.inMinutes % 60) / 60.0;
  final fixesPerHour = durationHours > 0
      ? points.length / durationHours
      : points.length.toDouble();
  final gpsRatio = assessment.gpsRatio;

  String label;
  if (assessment.metadataMissing) {
    label = 'Unknown';
  } else if (fixesPerHour >= 30 && gpsRatio > 0.7 && assessment.approximateRatio <= 0.5) {
    label = 'Excellent';
  } else if (fixesPerHour >= 12 && gpsRatio > 0.4 && assessment.approximateRatio <= 0.5) {
    label = 'Good';
  } else {
    label = 'Fair';
  }

  return JourneyQuality(fixCount: points.length, label: label);
}

JourneyScoreBreakdown computeJourneyScore(
  List<LocationHistoryPoint> points, {
  List<Geofence> geofences = const [],
  JourneyGpsContext? gpsContext,
}) {
  if (points.isEmpty) {
    return const JourneyScoreBreakdown(
      gpsAccuracy: 0,
      routeConsistency: 0,
      safety: 0,
      battery: 0,
    );
  }

  final assessment = assessJourneyGps(points, gpsContext: gpsContext);
  final quality = computeJourneyQuality(points, gpsContext: gpsContext);
  final events = detectJourneyEvents(points, geofences: geofences);
  final stopCount =
      events.where((e) => e.type == JourneyEventType.stopped).length;
  final gpsRatio = assessment.gpsRatio;
  final smoothed = smoothRouteForDisplay(points);
  final compressionRatio =
      points.isEmpty ? 1.0 : smoothed.length / points.length;

  var gpsAccuracy = assessment.shouldCapConfidence
      ? (gpsRatio * 25).round()
      : ((gpsRatio * 60) +
              (quality.label == 'Excellent'
                  ? 40
                  : quality.label == 'Good'
                      ? 25
                      : 10))
          .round();
  gpsAccuracy = gpsAccuracy.clamp(0, 100);

  final routeConsistency = ((compressionRatio.clamp(0.15, 1.0) * 70) +
          (stopCount <= 2 ? 30 : stopCount <= 4 ? 15 : 0))
      .round()
      .clamp(0, 100);

  final safety = (100 - (stopCount * 8).clamp(0, 40)).toInt().clamp(0, 100);

  final durationHours = journeyDuration(points).inMilliseconds / 3600000.0;
  final fixesPerHour =
      durationHours > 0 ? points.length / durationHours : points.length.toDouble();
  final battery = (fixesPerHour >= 6
          ? 95
          : fixesPerHour >= 2
              ? 75
              : 55)
      .toInt()
      .clamp(0, 100);

  return JourneyScoreBreakdown(
    gpsAccuracy: gpsAccuracy,
    routeConsistency: routeConsistency,
    safety: safety,
    battery: battery,
  );
}

Duration _segmentDuration(List<LocationHistoryPoint> points, int start, int end) {
  final startTime = points[start].recordedAt;
  final endTime = points[end].recordedAt;
  if (startTime == null || endTime == null) return Duration.zero;
  final delta = endTime.difference(startTime);
  return delta.isNegative ? Duration.zero : delta;
}

int countSafeZonesVisited(
  List<LocationHistoryPoint> points,
  List<Geofence> zones,
) {
  if (points.isEmpty || zones.isEmpty) return 0;
  final visited = <String>{};
  for (final zone in zones) {
    if (!zone.active) continue;
    for (final point in points) {
      final distance = haversineMeters(point.lat, point.lng, zone.lat, zone.lng);
      if (distance <= zone.radiusMeters) {
        visited.add(zone.id);
        break;
      }
    }
  }
  return visited.length;
}

JourneyHighlights computeJourneyHighlights(
  List<LocationHistoryPoint> points, {
  List<Geofence> zones = const [],
}) {
  if (points.isEmpty) {
    return const JourneyHighlights(
      longestStop: Duration.zero,
      highestSpeedKmh: null,
      totalMovingTime: Duration.zero,
      walkingTime: Duration.zero,
      safeZonesVisited: 0,
    );
  }

  final events = detectJourneyEvents(points, geofences: zones);
  var longestStop = Duration.zero;
  var totalMoving = Duration.zero;
  var walkingTime = Duration.zero;
  double? highestSpeed;

  for (final event in events) {
    final duration = _segmentDuration(points, event.startIndex, event.endIndex);
    if (event.type == JourneyEventType.stopped && duration > longestStop) {
      longestStop = duration;
    }
    if (event.type == JourneyEventType.walking ||
        event.type == JourneyEventType.vehicle) {
      totalMoving += duration;
    }
    if (event.type == JourneyEventType.walking) {
      walkingTime += duration;
    }
  }

  for (var i = 1; i < points.length; i++) {
    final speed = effectiveSpeedKmh(points[i - 1], points[i]);
    if (speed != null && (highestSpeed == null || speed > highestSpeed)) {
      highestSpeed = speed;
    }
  }

  return JourneyHighlights(
    longestStop: longestStop,
    highestSpeedKmh: highestSpeed,
    totalMovingTime: totalMoving,
    walkingTime: walkingTime,
    safeZonesVisited: countSafeZonesVisited(points, zones),
  );
}

JourneyHealth buildJourneyHealthForPoints(
  List<LocationHistoryPoint> points, {
  List<Geofence> geofences = const [],
  JourneyGpsContext? gpsContext,
}) {
  final insights = buildJourneyInsights(
    points,
    geofences: geofences,
    gpsContext: gpsContext,
  );
  final quality = computeJourneyQuality(points, gpsContext: gpsContext);
  final score = computeJourneyScore(
    points,
    geofences: geofences,
    gpsContext: gpsContext,
  );
  final assessment = assessJourneyGps(points, gpsContext: gpsContext);
  return computeJourneyHealth(
    insights,
    quality,
    score,
    gpsAssessment: assessment,
  );
}

JourneyHealth computeJourneyHealth(
  JourneyInsights insights,
  JourneyQuality quality,
  JourneyScoreBreakdown score, {
  JourneyGpsAssessment? gpsAssessment,
}) {
  final overall = score.overall;
  final cappedOverall = gpsAssessment?.shouldCapConfidence == true
      ? overall.clamp(0, 55)
      : overall;
  final stars = cappedOverall >= 90
      ? 5
      : cappedOverall >= 75
          ? 4
          : cappedOverall >= 60
              ? 3
              : cappedOverall >= 40
                  ? 2
                  : 1;

  final assessment = gpsAssessment ??
      const JourneyGpsAssessment(
        metadataCoverage: 1,
        gpsRatio: 1,
        approximateRatio: 0,
        frozenCoordinates: false,
        liveGpsUnreliable: false,
        warningMessage: null,
      );
  final gpsPhrase = _gpsHealthPhrase(quality, assessment);

  final routePhrase = insights.stopCount == 0
      ? 'Normal route, no detours'
      : insights.stopCount <= 2
          ? 'Normal route, brief stops'
          : 'Unusual stops detected';

  return JourneyHealth(
    stars: stars,
    summary: '$routePhrase, $gpsPhrase',
  );
}

JourneyInsights buildJourneyInsights(
  List<LocationHistoryPoint> points, {
  List<Geofence> geofences = const [],
  JourneyGpsContext? gpsContext,
}) {
  if (points.isEmpty) {
    return const JourneyInsights(
      routeSummary: 'No journey data',
      avgSpeedKmh: null,
      gpsQualityLabel: 'Unknown',
      confidenceScore: 0,
      confidenceExplanation: 'Based on 0 GPS fixes',
      stopCount: 0,
      highDataQuality: false,
      confidenceSubtitle: 'Unable to determine with confidence',
    );
  }

  final stats = buildJourneyStats(points);
  final events = detectJourneyEvents(points, geofences: geofences);
  final stopCount =
      events.where((e) => e.type == JourneyEventType.stopped).length;

  final durationHours = stats.duration.inMilliseconds / 3600000.0;
  final avgSpeed = durationHours > 0 ? stats.distanceKm / durationHours : null;

  final assessment = assessJourneyGps(points, gpsContext: gpsContext);
  final withTimestamps =
      points.where((p) => p.recordedAt != null).length / points.length;
  final withSpeed = points.where((p) => p.speedKmh != null).length / points.length;

  var confidence = 0;
  if (withTimestamps > 0.8) confidence += 20;
  if (points.length >= 20) confidence += 15;
  if (withSpeed > 0.5) confidence += 15;
  if (assessment.metadataCoverage >= 0.5) {
    if (assessment.gpsRatio > 0.7) {
      confidence += 30;
    } else if (assessment.gpsRatio > 0.4) {
      confidence += 15;
    }
  }

  if (assessment.shouldCapConfidence) {
    confidence = assessment.liveGpsUnreliable
        ? confidence.clamp(0, 25)
        : confidence.clamp(0, 40);
  } else {
    confidence = confidence.clamp(0, 100);
  }

  final quality = computeJourneyQuality(points, gpsContext: gpsContext);
  final gpsQuality = _gpsQualityLabel(quality, assessment);

  final routeSummary = stopCount >= 3
      ? 'Unusual stops detected ($stopCount pauses)'
      : stopCount >= 1
          ? 'Brief stops along the route'
          : 'Normal route pattern';

  final explanation = assessment.warningMessage ??
      'Based on ${points.length} GPS fixes';

  return JourneyInsights(
    routeSummary: routeSummary,
    avgSpeedKmh: avgSpeed,
    gpsQualityLabel: gpsQuality,
    confidenceScore: confidence,
    confidenceExplanation: explanation,
    stopCount: stopCount,
    highDataQuality: confidence >= 70 &&
        !assessment.shouldCapConfidence &&
        quality.label == 'Excellent',
    confidenceSubtitle: assessment.warningMessage != null
        ? (assessment.liveGpsUnreliable
            ? 'Limited GPS data'
            : 'Limited confidence')
        : null,
  );
}

String narrationForEvent(JourneyEvent event, List<LocationHistoryPoint> points) {
  return switch (event.type) {
    JourneyEventType.leftHome => 'Left home. Journey tracking started.',
    JourneyEventType.walking => event.transportMode == TransportMode.running
        ? 'Running detected. Pace looks brisk.'
        : event.transportMode == TransportMode.bicycle
            ? 'Cycling movement detected.'
            : 'Walking movement detected.',
    JourneyEventType.vehicle => () {
        var totalSpeed = 0.0;
        var count = 0;
        for (var i = event.startIndex + 1; i <= event.endIndex; i++) {
          final speed = effectiveSpeedKmh(points[i - 1], points[i]);
          if (speed == null) continue;
          totalSpeed += speed;
          count++;
        }
        final avg = count == 0 ? null : totalSpeed / count;
        return avg == null
            ? 'Vehicle movement detected.'
            : 'Vehicle movement detected. Average speed ${avg.toStringAsFixed(0)} km/h.';
      }(),
    JourneyEventType.stopped => 'Stop detected. Device stationary.',
    JourneyEventType.dwell => event.label,
    JourneyEventType.arrived => 'Arrived at destination. Journey complete.',
  };
}

double eventProgress(JourneyEvent event, int pointCount) {
  if (pointCount <= 1) return 0;
  return (event.startIndex / (pointCount - 1)).clamp(0.0, 1.0);
}

DateTime? interpolateJourneyTime(
  List<LocationHistoryPoint> points,
  double progress,
) {
  if (points.isEmpty) return null;
  if (points.length == 1) return points.first.recordedAt;

  final start = points.first.recordedAt;
  final end = points.last.recordedAt;
  if (start == null || end == null) return null;

  final clamped = progress.clamp(0.0, 1.0);
  final millis = start.millisecondsSinceEpoch +
      ((end.millisecondsSinceEpoch - start.millisecondsSinceEpoch) * clamped)
          .round();
  return DateTime.fromMillisecondsSinceEpoch(millis);
}

String formatJourneyDuration(Duration duration) {
  if (duration.inHours > 0) {
    return '${duration.inHours}h ${duration.inMinutes.remainder(60)}m';
  }
  if (duration.inMinutes > 0) {
    return '${duration.inMinutes} min';
  }
  return '${duration.inSeconds}s';
}

/// Grid cell for heat-map overlay — visit count at cell centre.
class HeatmapCell {
  const HeatmapCell({
    required this.lat,
    required this.lng,
    required this.visitCount,
  });

  final double lat;
  final double lng;
  final int visitCount;
}

/// Clusters GPS fixes into ~[cellSizeMeters] grid cells for heat-map circles.
List<HeatmapCell> buildHeatmapCells(
  List<LocationHistoryPoint> points, {
  double cellSizeMeters = 80,
}) {
  if (points.isEmpty) return const [];

  final latScale = _earthRadiusM * math.pi / 180;
  final counts = <String, ({double lat, double lng, int count})>{};

  for (final p in points) {
    final lngScale = latScale * math.cos(p.lat * math.pi / 180);
    final cellLat = (p.lat * latScale / cellSizeMeters).round();
    final cellLng = (p.lng * lngScale / cellSizeMeters).round();
    final key = '$cellLat:$cellLng';
    final existing = counts[key];
    if (existing == null) {
      counts[key] = (lat: p.lat, lng: p.lng, count: 1);
    } else {
      counts[key] = (
        lat: (existing.lat * existing.count + p.lat) / (existing.count + 1),
        lng: (existing.lng * existing.count + p.lng) / (existing.count + 1),
        count: existing.count + 1,
      );
    }
  }

  return counts.values
      .map((c) => HeatmapCell(lat: c.lat, lng: c.lng, visitCount: c.count))
      .toList(growable: false);
}

/// Route overlap similarity (0–100) via point proximity and start/end anchors.
int computeRouteSimilarity(
  List<LocationHistoryPoint> primary,
  List<LocationHistoryPoint> compare, {
  double matchRadiusMeters = 120,
}) {
  if (primary.isEmpty || compare.isEmpty) return 0;

  final primarySample = _samplePoints(primary, maxSamples: 40);
  final compareSample = _samplePoints(compare, maxSamples: 40);

  var matched = 0;
  for (final p in primarySample) {
    final nearest = compareSample
        .map((c) => haversineMeters(p.lat, p.lng, c.lat, c.lng))
        .reduce(math.min);
    if (nearest <= matchRadiusMeters) matched++;
  }

  final overlapScore = primarySample.isEmpty
      ? 0.0
      : matched / primarySample.length;

  final startDist = haversineMeters(
    primary.first.lat,
    primary.first.lng,
    compare.first.lat,
    compare.first.lng,
  );
  final endDist = haversineMeters(
    primary.last.lat,
    primary.last.lng,
    compare.last.lat,
    compare.last.lng,
  );

  var anchorScore = 0.0;
  if (startDist <= matchRadiusMeters) anchorScore += 0.5;
  if (endDist <= matchRadiusMeters) anchorScore += 0.5;

  return ((overlapScore * 0.75 + anchorScore * 0.25) * 100).round().clamp(0, 100);
}

List<LocationHistoryPoint> _samplePoints(
  List<LocationHistoryPoint> points, {
  required int maxSamples,
}) {
  if (points.length <= maxSamples) return points;
  final step = (points.length / maxSamples).ceil().clamp(1, points.length);
  return [
    for (var i = 0; i < points.length; i += step) points[i],
  ];
}

String compareSimilarityNarration(int similarityPercent, DateTime compareDay) {
  final dayLabel = DateFormat.yMMMEd().format(compareDay);
  if (similarityPercent >= 90) {
    return "Today's journey matched the usual route with $similarityPercent% similarity ($dayLabel).";
  }
  if (similarityPercent >= 70) {
    return 'Route mostly familiar — $similarityPercent% overlap with $dayLabel.';
  }
  if (similarityPercent >= 40) {
    return 'Some detours today — $similarityPercent% similar to $dayLabel.';
  }
  return 'Unusual route pattern — only $similarityPercent% overlap with $dayLabel.';
}

/// Typical Mauritius conditions placeholder — no live API.
TypicalWeather typicalWeatherForMonth(int month) {
  return switch (month) {
    12 || 1 || 2 || 3 => const TypicalWeather(
        icon: '🌤',
        label: 'Partly cloudy',
        tempC: 28,
      ),
    4 || 5 || 10 || 11 => const TypicalWeather(
        icon: '⛅',
        label: 'Warm & humid',
        tempC: 26,
      ),
    6 || 7 || 8 => const TypicalWeather(
        icon: '☀️',
        label: 'Dry season',
        tempC: 24,
      ),
    _ => const TypicalWeather(
        icon: '🌦',
        label: 'Light showers',
        tempC: 25,
      ),
  };
}

class TypicalWeather {
  const TypicalWeather({
    required this.icon,
    required this.label,
    required this.tempC,
  });

  final String icon;
  final String label;
  final int tempC;

  String get display => '$icon $label $tempC°C';
}

/// Decode a Google encoded polyline (precision 5).
List<({double lat, double lng})> decodePolyline(String encoded) {
  if (encoded.isEmpty) return const [];

  final points = <({double lat, double lng})>[];
  var index = 0;
  var lat = 0;
  var lng = 0;

  while (index < encoded.length) {
    var shift = 0;
    var result = 0;
    int b;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    final dlat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    final dlng = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.add((lat: lat / 1e5, lng: lng / 1e5));
  }

  return points;
}

/// Expand compressed journey polylines into timestamped GPS points.
List<LocationHistoryPoint> pointsFromJourneyRecords(List<JourneyRecord> journeys) {
  if (journeys.isEmpty) return const [];

  final sorted = List<JourneyRecord>.from(journeys)
    ..sort((a, b) => a.startAt.compareTo(b.startAt));

  final points = <LocationHistoryPoint>[];
  for (final journey in sorted) {
    points.addAll(_pointsFromJourneyRecord(journey));
  }
  return points;
}

List<LocationHistoryPoint> _pointsFromJourneyRecord(JourneyRecord journey) {
  final coords = decodePolyline(journey.polyline);
  if (coords.isEmpty) return const [];

  final startMs = journey.startAt.millisecondsSinceEpoch;
  final endMs = journey.endAt.millisecondsSinceEpoch;
  final spanMs = endMs - startMs;

  return [
    for (var i = 0; i < coords.length; i++)
      LocationHistoryPoint(
        lat: coords[i].lat,
        lng: coords[i].lng,
        recordedAt: coords.length == 1
            ? journey.startAt
            : DateTime.fromMillisecondsSinceEpoch(
                startMs + ((spanMs * i) / (coords.length - 1)).round(),
              ),
      ),
  ];
}

String labelForDwellSegment(
  DwellSegment dwell, {
  List<Geofence> geofences = const [],
}) {
  final fromLabel = DateFormat.Hm().format(dwell.from);
  final toLabel = DateFormat.Hm().format(dwell.to);
  final place = _dwellPlaceLabel(dwell, geofences);
  return 'Stayed at $place $fromLabel–$toLabel';
}

String _dwellPlaceLabel(DwellSegment dwell, List<Geofence> geofences) {
  final placeName = dwell.placeName?.trim();
  if (placeName != null && placeName.isNotEmpty) return placeName;

  final geofenceId = dwell.geofenceId;
  if (geofenceId != null) {
    for (final zone in geofences) {
      if (zone.id == geofenceId && zone.name.trim().isNotEmpty) {
        return zone.name.trim();
      }
    }
  }

  for (final zone in geofences) {
    if (!zone.active) continue;
    final distance = haversineMeters(
      dwell.centerLat,
      dwell.centerLng,
      zone.lat,
      zone.lng,
    );
    if (distance <= zone.radiusMeters) {
      return zone.name.trim().isEmpty ? 'safe zone' : zone.name.trim();
    }
  }

  return 'location';
}

int? _nearestPointIndexForTime(
  List<LocationHistoryPoint> points,
  DateTime time,
) {
  if (points.isEmpty) return null;
  var bestIndex = 0;
  var bestDelta = Duration(days: 9999);
  for (var i = 0; i < points.length; i++) {
    final recordedAt = points[i].recordedAt;
    if (recordedAt == null) continue;
    final delta = recordedAt.difference(time).abs();
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/// Merge gateway dwell segments with movement events into one timeline.
List<JourneyEvent> mergeDwellAndMovementEvents({
  required List<DwellSegment> dwells,
  required List<JourneyEvent> movementEvents,
  required List<LocationHistoryPoint> points,
  List<Geofence> geofences = const [],
}) {
  final merged = List<JourneyEvent>.from(movementEvents);

  for (final dwell in dwells) {
    final index = _nearestPointIndexForTime(points, dwell.from) ?? 0;
    merged.add(
      JourneyEvent(
        type: JourneyEventType.dwell,
        label: labelForDwellSegment(dwell, geofences: geofences),
        startIndex: index,
        endIndex: index,
        at: dwell.from,
        transportMode: TransportMode.stationary,
      ),
    );
  }

  merged.sort((a, b) {
    final aTime = a.at ?? DateTime.fromMillisecondsSinceEpoch(0);
    final bTime = b.at ?? DateTime.fromMillisecondsSinceEpoch(0);
    return aTime.compareTo(bTime);
  });

  return merged;
}

/// Build replay input from gateway journeys + dwell segments (falls back to raw points).
JourneyDayData buildJourneyDayData({
  required List<LocationHistoryPoint> locationPoints,
  required List<JourneyRecord> journeys,
  required List<DwellSegment> dwells,
  List<Geofence> geofences = const [],
}) {
  final points = journeys.isNotEmpty
      ? pointsFromJourneyRecords(journeys)
      : locationPoints;

  final movementEvents = detectJourneyEvents(points, geofences: geofences);
  final events = dwells.isEmpty
      ? movementEvents
      : mergeDwellAndMovementEvents(
          dwells: dwells,
          movementEvents: movementEvents,
          points: points,
          geofences: geofences,
        );

  return JourneyDayData(
    points: points,
    events: events,
    dwells: dwells,
    journeys: journeys,
  );
}

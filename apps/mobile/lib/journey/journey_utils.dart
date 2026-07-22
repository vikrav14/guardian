import 'dart:math' as math;

import 'package:intl/intl.dart';

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
  };
}

String emojiForEventType(JourneyEventType type) {
  return switch (type) {
    JourneyEventType.leftHome => '🏠',
    JourneyEventType.walking => '🚶',
    JourneyEventType.vehicle => '🚌',
    JourneyEventType.stopped => '⏸',
    JourneyEventType.arrived => '🏁',
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

/// Infers movement segments from speed (device-reported or computed).
List<JourneyEvent> detectJourneyEvents(List<LocationHistoryPoint> points) {
  if (points.isEmpty) return const [];

  final events = <JourneyEvent>[
    JourneyEvent(
      type: JourneyEventType.leftHome,
      label: labelForEventType(JourneyEventType.leftHome),
      startIndex: 0,
      endIndex: 0,
      at: points.first.recordedAt,
      transportMode: TransportMode.stationary,
    ),
  ];

  if (points.length == 1) {
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
    return events;
  }

  var index = 1;
  while (index < points.length) {
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
  events.add(
    JourneyEvent(
      type: JourneyEventType.arrived,
      label: labelForEventType(JourneyEventType.arrived),
      startIndex: lastIndex,
      endIndex: lastIndex,
      at: points[lastIndex].recordedAt,
      transportMode: TransportMode.stationary,
    ),
  );

  return events;
}

double _gpsRatio(List<LocationHistoryPoint> points) {
  final gpsSources = points
      .map((p) => p.accuracySource?.toLowerCase())
      .whereType<String>()
      .toList();
  if (gpsSources.isEmpty) return 0.5;
  return gpsSources.where((s) => s.contains('gps')).length / gpsSources.length;
}

JourneyQuality computeJourneyQuality(List<LocationHistoryPoint> points) {
  if (points.isEmpty) {
    return const JourneyQuality(fixCount: 0, label: 'Unknown');
  }

  final stats = buildJourneyStats(points);
  final durationHours =
      stats.duration.inHours + (stats.duration.inMinutes % 60) / 60.0;
  final fixesPerHour = durationHours > 0
      ? points.length / durationHours
      : points.length.toDouble();
  final gpsRatio = _gpsRatio(points);

  String label;
  if (fixesPerHour >= 30 && gpsRatio > 0.7) {
    label = 'Excellent';
  } else if (fixesPerHour >= 12 && gpsRatio > 0.4) {
    label = 'Good';
  } else {
    label = 'Fair';
  }

  return JourneyQuality(fixCount: points.length, label: label);
}

JourneyScoreBreakdown computeJourneyScore(List<LocationHistoryPoint> points) {
  if (points.isEmpty) {
    return const JourneyScoreBreakdown(
      gpsAccuracy: 0,
      routeConsistency: 0,
      safety: 0,
      battery: 0,
    );
  }

  final quality = computeJourneyQuality(points);
  final events = detectJourneyEvents(points);
  final stopCount =
      events.where((e) => e.type == JourneyEventType.stopped).length;
  final gpsRatio = _gpsRatio(points);
  final smoothed = smoothRouteForDisplay(points);
  final compressionRatio =
      points.isEmpty ? 1.0 : smoothed.length / points.length;

  final gpsAccuracy = ((gpsRatio * 60) +
          (quality.label == 'Excellent'
              ? 40
              : quality.label == 'Good'
                  ? 25
                  : 10))
      .round()
      .clamp(0, 100);

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

  final events = detectJourneyEvents(points);
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

JourneyHealth computeJourneyHealth(
  JourneyInsights insights,
  JourneyQuality quality,
  JourneyScoreBreakdown score,
) {
  final overall = score.overall;
  final stars = overall >= 90
      ? 5
      : overall >= 75
          ? 4
          : overall >= 60
              ? 3
              : overall >= 40
                  ? 2
                  : 1;

  final gpsPhrase = quality.label == 'Excellent'
      ? 'excellent GPS'
      : quality.label == 'Good'
          ? 'good GPS'
          : 'fair GPS';

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

JourneyInsights buildJourneyInsights(List<LocationHistoryPoint> points) {
  if (points.isEmpty) {
    return const JourneyInsights(
      routeSummary: 'No journey data',
      avgSpeedKmh: null,
      gpsQualityLabel: 'Unknown',
      confidenceScore: 0,
      stopCount: 0,
      verified: false,
    );
  }

  final stats = buildJourneyStats(points);
  final events = detectJourneyEvents(points);
  final stopCount =
      events.where((e) => e.type == JourneyEventType.stopped).length;

  final durationHours = stats.duration.inMilliseconds / 3600000.0;
  final avgSpeed = durationHours > 0 ? stats.distanceKm / durationHours : null;

  final withTimestamps =
      points.where((p) => p.recordedAt != null).length / points.length;
  final withSpeed = points.where((p) => p.speedKmh != null).length / points.length;
  final gpsRatio = _gpsRatio(points);

  var confidence = 0;
  if (withTimestamps > 0.8) confidence += 30;
  if (points.length >= 20) confidence += 20;
  if (withSpeed > 0.5) confidence += 20;
  if (gpsRatio > 0.5) confidence += 30;
  confidence = confidence.clamp(0, 100);

  final quality = computeJourneyQuality(points);
  final gpsQuality = quality.label == 'Unknown'
      ? 'GPS quality unknown'
      : '${quality.label} GPS coverage';

  final routeSummary = stopCount >= 3
      ? 'Unusual stops detected ($stopCount pauses)'
      : stopCount >= 1
          ? 'Brief stops along the route'
          : 'Normal route pattern';

  return JourneyInsights(
    routeSummary: routeSummary,
    avgSpeedKmh: avgSpeed,
    gpsQualityLabel: gpsQuality,
    confidenceScore: confidence,
    stopCount: stopCount,
    verified: confidence >= 80 && quality.label != 'Fair',
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

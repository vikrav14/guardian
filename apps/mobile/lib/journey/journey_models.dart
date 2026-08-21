import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../models/location_history_point.dart';

enum JourneyEventType { leftHome, walking, vehicle, stopped, arrived, dwell }

enum TransportMode { stationary, walking, bicycle, running, vehicle }

enum RouteSegmentColor { green, blue, purple }

class JourneyEvent {
  const JourneyEvent({
    required this.type,
    required this.label,
    required this.startIndex,
    required this.endIndex,
    this.at,
    this.transportMode,
  });

  final JourneyEventType type;
  final String label;
  final int startIndex;
  final int endIndex;
  final DateTime? at;
  final TransportMode? transportMode;

  bool containsIndex(int index) => index >= startIndex && index <= endIndex;
}

class JourneyStats {
  const JourneyStats({
    required this.pointCount,
    required this.distanceKm,
    required this.duration,
    this.startTime,
    this.endTime,
  });

  final int pointCount;
  final double distanceKm;
  final Duration duration;
  final DateTime? startTime;
  final DateTime? endTime;
}

class JourneyScoreBreakdown {
  const JourneyScoreBreakdown({
    required this.gpsAccuracy,
    required this.routeConsistency,
    required this.safety,
    required this.battery,
  });

  final int gpsAccuracy;
  final int routeConsistency;
  final int safety;
  final int battery;

  int get overall =>
      ((gpsAccuracy + routeConsistency + safety + battery) / 4).round();
}

class JourneyHighlights {
  const JourneyHighlights({
    required this.longestStop,
    required this.highestSpeedKmh,
    required this.totalMovingTime,
    required this.walkingTime,
    required this.safeZonesVisited,
  });

  final Duration longestStop;
  final double? highestSpeedKmh;
  final Duration totalMovingTime;
  final Duration walkingTime;
  final int safeZonesVisited;
}

class JourneyQuality {
  const JourneyQuality({required this.fixCount, required this.label});

  final int fixCount;
  final String label;

  String get fixesLabel => '$fixCount GPS fixes';
}

class JourneyHealth {
  const JourneyHealth({required this.stars, required this.summary});

  final int stars;
  final String summary;
}

class RouteSegment {
  const RouteSegment({
    required this.startIndex,
    required this.endIndex,
    required this.mode,
    required this.color,
  });

  final int startIndex;
  final int endIndex;
  final TransportMode mode;
  final RouteSegmentColor color;
}

/// Live device GPS signals passed into journey insight builders.
class JourneyGpsContext {
  const JourneyGpsContext({
    this.liveGpsFresh = false,
    this.liveApproximateFix = false,
    this.staleGpsActive = false,
    this.isViewingToday = false,
  });

  final bool liveGpsFresh;
  final bool liveApproximateFix;
  final bool staleGpsActive;
  final bool isViewingToday;
}

class JourneyInsights {
  const JourneyInsights({
    required this.routeSummary,
    required this.avgSpeedKmh,
    required this.gpsQualityLabel,
    required this.confidenceScore,
    required this.confidenceExplanation,
    required this.stopCount,
    required this.highDataQuality,
    this.confidenceSubtitle,
  });

  final String routeSummary;
  final double? avgSpeedKmh;
  final String gpsQualityLabel;
  final int confidenceScore;
  final String confidenceExplanation;
  final int stopCount;
  final bool highDataQuality;

  /// Short badge suffix when confidence is capped (e.g. "Limited GPS data").
  final String? confidenceSubtitle;
}

/// Gateway-written dwell segment (`devices/{imei}/segments`).
class DwellSegment {
  const DwellSegment({
    required this.id,
    required this.from,
    required this.to,
    required this.centerLat,
    required this.centerLng,
    this.placeName,
    this.geofenceId,
  });

  final String id;
  final DateTime from;
  final DateTime to;
  final double centerLat;
  final double centerLng;
  final String? placeName;
  final String? geofenceId;

  factory DwellSegment.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return DwellSegment(
      id: doc.id,
      from: _asDateTime(data['from']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      to: _asDateTime(data['to']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      centerLat: (data['centerLat'] as num?)?.toDouble() ?? 0,
      centerLng: (data['centerLng'] as num?)?.toDouble() ?? 0,
      placeName: data['placeName'] as String?,
      geofenceId: data['geofenceId'] as String?,
    );
  }
}

/// Factual stop derived by the gateway from stationary GPS points inside one outing.
/// A null [placeName] is intentional: Guardian must not guess a business or purpose.
class JourneyStop {
  const JourneyStop({
    required this.id,
    required this.startAt,
    required this.endAt,
    required this.durationMinutes,
    required this.centerLat,
    required this.centerLng,
    required this.pointStartIndex,
    required this.pointEndIndex,
    this.placeName,
    this.source = 'gps_dwell',
  });

  final String id;
  final DateTime startAt;
  final DateTime endAt;
  final double durationMinutes;
  final double centerLat;
  final double centerLng;
  final int pointStartIndex;
  final int pointEndIndex;
  final String? placeName;
  final String source;

  Duration get duration =>
      Duration(milliseconds: (durationMinutes * 60 * 1000).round());

  factory JourneyStop.fromMap(Map<String, dynamic> data) {
    return JourneyStop(
      id: data['id'] as String? ?? '',
      startAt:
          _asDateTime(data['startAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      endAt:
          _asDateTime(data['endAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      durationMinutes: (data['durationMinutes'] as num?)?.toDouble() ?? 0,
      centerLat: (data['centerLat'] as num?)?.toDouble() ?? 0,
      centerLng: (data['centerLng'] as num?)?.toDouble() ?? 0,
      pointStartIndex: (data['pointStartIndex'] as num?)?.toInt() ?? 0,
      pointEndIndex: (data['pointEndIndex'] as num?)?.toInt() ?? 0,
      placeName: data['placeName'] as String?,
      source: data['source'] as String? ?? 'gps_dwell',
    );
  }
}

/// Movement portion between the outing origin, factual stops, and final destination.
class JourneyLeg {
  const JourneyLeg({
    required this.id,
    required this.startAt,
    required this.endAt,
    required this.durationMinutes,
    required this.distanceKm,
    required this.pointStartIndex,
    required this.pointEndIndex,
    this.fromStopId,
    this.toStopId,
  });

  final String id;
  final DateTime startAt;
  final DateTime endAt;
  final double durationMinutes;
  final double distanceKm;
  final int pointStartIndex;
  final int pointEndIndex;
  final String? fromStopId;
  final String? toStopId;

  Duration get duration =>
      Duration(milliseconds: (durationMinutes * 60 * 1000).round());

  factory JourneyLeg.fromMap(Map<String, dynamic> data) {
    return JourneyLeg(
      id: data['id'] as String? ?? '',
      startAt:
          _asDateTime(data['startAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      endAt:
          _asDateTime(data['endAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      durationMinutes: (data['durationMinutes'] as num?)?.toDouble() ?? 0,
      distanceKm: (data['distanceKm'] as num?)?.toDouble() ?? 0,
      pointStartIndex: (data['pointStartIndex'] as num?)?.toInt() ?? 0,
      pointEndIndex: (data['pointEndIndex'] as num?)?.toInt() ?? 0,
      fromStopId: data['fromStopId'] as String?,
      toStopId: data['toStopId'] as String?,
    );
  }
}

/// Compressed journey route (`devices/{imei}/journeys`).
class JourneyPointEvidence {
  const JourneyPointEvidence({
    required this.offsetMs,
    this.source,
    this.gpsValid = false,
    this.accuracyMeters,
    this.satellites,
    this.speedKmh,
    this.placeName,
  });

  final int offsetMs;
  final String? source;
  final bool gpsValid;
  final double? accuracyMeters;
  final int? satellites;
  final double? speedKmh;
  final String? placeName;

  factory JourneyPointEvidence.fromMap(Map<String, dynamic> data) {
    return JourneyPointEvidence(
      offsetMs: (data['offsetMs'] as num?)?.toInt() ?? 0,
      source: data['source'] as String?,
      gpsValid: data['gpsValid'] as bool? ?? false,
      accuracyMeters: (data['accuracyMeters'] as num?)?.toDouble(),
      satellites: (data['satellites'] as num?)?.toInt(),
      speedKmh: (data['speedKmh'] as num?)?.toDouble(),
      placeName: data['placeName'] as String?,
    );
  }
}

class JourneyRouteGap {
  const JourneyRouteGap({
    this.fromPointIndex,
    this.toPointIndex,
    required this.fromOffsetMs,
    required this.toOffsetMs,
    required this.durationSeconds,
  });

  final int? fromPointIndex;
  final int? toPointIndex;
  final int fromOffsetMs;
  final int toOffsetMs;
  final int durationSeconds;

  Duration get duration => Duration(seconds: durationSeconds);

  factory JourneyRouteGap.fromMap(Map<String, dynamic> data) {
    return JourneyRouteGap(
      fromPointIndex: (data['fromPointIndex'] as num?)?.toInt(),
      toPointIndex: (data['toPointIndex'] as num?)?.toInt(),
      fromOffsetMs: (data['fromOffsetMs'] as num?)?.toInt() ?? 0,
      toOffsetMs: (data['toOffsetMs'] as num?)?.toInt() ?? 0,
      durationSeconds: (data['durationSeconds'] as num?)?.toInt() ?? 0,
    );
  }
}

class JourneyRouteSegment {
  const JourneyRouteSegment({
    required this.startPointIndex,
    required this.endPointIndex,
    required this.pointCount,
    required this.distanceKm,
    required this.polyline,
  });

  final int startPointIndex;
  final int endPointIndex;
  final int pointCount;
  final double distanceKm;
  final String polyline;

  factory JourneyRouteSegment.fromMap(Map<String, dynamic> data) {
    return JourneyRouteSegment(
      startPointIndex: (data['startPointIndex'] as num?)?.toInt() ?? 0,
      endPointIndex: (data['endPointIndex'] as num?)?.toInt() ?? 0,
      pointCount: (data['pointCount'] as num?)?.toInt() ?? 0,
      distanceKm: (data['distanceKm'] as num?)?.toDouble() ?? 0,
      polyline: data['polyline'] as String? ?? '',
    );
  }
}

class JourneyRouteCoverage {
  const JourneyRouteCoverage({
    this.pointCount = 0,
    this.gpsPointCount = 0,
    this.approximatePointCount = 0,
    this.unknownSourcePointCount = 0,
    this.gapCount = 0,
    this.largestGapSeconds = 0,
    this.interrupted = false,
    this.structureReliable = true,
  });

  final int pointCount;
  final int gpsPointCount;
  final int approximatePointCount;
  final int unknownSourcePointCount;
  final int gapCount;
  final int largestGapSeconds;
  final bool interrupted;
  final bool structureReliable;

  Duration get largestGap => Duration(seconds: largestGapSeconds);

  factory JourneyRouteCoverage.fromMap(Map<String, dynamic> data) {
    return JourneyRouteCoverage(
      pointCount: (data['pointCount'] as num?)?.toInt() ?? 0,
      gpsPointCount: (data['gpsPointCount'] as num?)?.toInt() ?? 0,
      approximatePointCount:
          (data['approximatePointCount'] as num?)?.toInt() ?? 0,
      unknownSourcePointCount:
          (data['unknownSourcePointCount'] as num?)?.toInt() ?? 0,
      gapCount: (data['gapCount'] as num?)?.toInt() ?? 0,
      largestGapSeconds:
          (data['largestGapSeconds'] as num?)?.toInt() ?? 0,
      interrupted: data['interrupted'] as bool? ?? false,
      structureReliable: data['structureReliable'] as bool? ?? true,
    );
  }
}

class JourneyPresentationSegment {
  const JourneyPresentationSegment({
    required this.source,
    required this.polyline,
    required this.fromPointIndex,
    required this.toPointIndex,
    required this.fromOffsetMs,
    required this.toOffsetMs,
    this.roadAligned = false,
    this.confidence,
  });

  final String source;
  final String polyline;
  final int fromPointIndex;
  final int toPointIndex;
  final int fromOffsetMs;
  final int toOffsetMs;
  final bool roadAligned;
  final String? confidence;

  bool get isGoogle => source == 'google';

  factory JourneyPresentationSegment.fromMap(Map<String, dynamic> data) {
    return JourneyPresentationSegment(
      source: data['source'] as String? ?? 'gps',
      polyline: data['polyline'] as String? ?? '',
      fromPointIndex: (data['fromPointIndex'] as num?)?.toInt() ?? 0,
      toPointIndex: (data['toPointIndex'] as num?)?.toInt() ?? 0,
      fromOffsetMs: (data['fromOffsetMs'] as num?)?.toInt() ?? 0,
      toOffsetMs: (data['toOffsetMs'] as num?)?.toInt() ?? 0,
      roadAligned: data['roadAligned'] as bool? ?? false,
      confidence: data['confidence'] as String?,
    );
  }
}

class JourneyStopPlace {
  const JourneyStopPlace({
    required this.stopId,
    required this.pointStartIndex,
    required this.pointEndIndex,
    required this.placeId,
    required this.label,
    this.displayName,
    this.primaryType,
    this.distanceMeters,
    this.provider = 'google_places',
  });

  final String stopId;
  final int pointStartIndex;
  final int pointEndIndex;
  final String placeId;
  final String label;
  final String? displayName;
  final String? primaryType;
  final int? distanceMeters;
  final String provider;

  bool containsPoint(int index) =>
      index >= pointStartIndex && index <= pointEndIndex;

  factory JourneyStopPlace.fromMap(Map<String, dynamic> data) {
    return JourneyStopPlace(
      stopId: data['stopId'] as String? ?? '',
      pointStartIndex: (data['pointStartIndex'] as num?)?.toInt() ?? 0,
      pointEndIndex: (data['pointEndIndex'] as num?)?.toInt() ?? 0,
      placeId: data['placeId'] as String? ?? '',
      label: data['label'] as String? ?? '',
      displayName: data['displayName'] as String?,
      primaryType: data['primaryType'] as String?,
      distanceMeters: (data['distanceMeters'] as num?)?.toInt(),
      provider: data['provider'] as String? ?? 'google_places',
    );
  }
}

class JourneyRoutePresentation {
  const JourneyRoutePresentation({
    required this.version,
    required this.generatedAt,
    required this.expiresAt,
    required this.segments,
    required this.stopPlaces,
    this.attribution = 'Google Maps',
  });

  final int version;
  final DateTime generatedAt;
  final DateTime expiresAt;
  final List<JourneyPresentationSegment> segments;
  final List<JourneyStopPlace> stopPlaces;
  final String attribution;

  bool isUsableAt(DateTime now) =>
      version == 1 &&
      expiresAt.isAfter(now) &&
      (segments.isNotEmpty || stopPlaces.isNotEmpty);

  bool get hasGoogleSegments => segments.any((segment) => segment.isGoogle);

  JourneyStopPlace? placeForStop(JourneyStop stop) {
    for (final place in stopPlaces) {
      if (place.stopId == stop.id) return place;
    }
    return null;
  }

  JourneyStopPlace? placeForPoint(int pointIndex) {
    for (final place in stopPlaces) {
      if (place.containsPoint(pointIndex)) return place;
    }
    return null;
  }

  factory JourneyRoutePresentation.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? <String, dynamic>{};
    final rawSegments = data['segments'];
    final rawStopPlaces = data['stopPlaces'];
    return JourneyRoutePresentation(
      version: (data['version'] as num?)?.toInt() ?? 0,
      generatedAt:
          _asDateTime(data['generatedAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      expiresAt:
          _asDateTime(data['expiresAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      segments: rawSegments is List
          ? rawSegments
                .whereType<Map>()
                .map(
                  (item) => JourneyPresentationSegment.fromMap(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where((segment) => segment.polyline.isNotEmpty)
                .toList(growable: false)
          : const [],
      stopPlaces: rawStopPlaces is List
          ? rawStopPlaces
                .whereType<Map>()
                .map(
                  (item) => JourneyStopPlace.fromMap(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where(
                  (place) => place.placeId.isNotEmpty && place.label.isNotEmpty,
                )
                .toList(growable: false)
          : const [],
      attribution: data['attribution'] as String? ?? 'Google Maps',
    );
  }
}

class JourneyRecord {
  const JourneyRecord({
    required this.id,
    required this.startAt,
    required this.endAt,
    required this.polyline,
    required this.distanceKm,
    required this.pointCount,
    this.compressed = true,
    this.events = const [],
    this.stops = const [],
    this.legs = const [],
    this.stopCount = 0,
    this.legCount = 0,
    this.closeReason,
    this.originGeofenceName,
    this.departureAt,
    this.returnAt,
    this.evidenceVersion = 0,
    this.pointEvidence = const [],
    this.routeStartAnchored = false,
    this.routeStartEvidence,
    this.routeGaps = const [],
    this.routeSegments = const [],
    this.routeCoverage = const JourneyRouteCoverage(),
  });

  final String id;
  final DateTime startAt;
  final DateTime endAt;
  final String polyline;
  final double distanceKm;
  final int pointCount;
  final bool compressed;
  final List<Map<String, dynamic>> events;
  final List<JourneyStop> stops;
  final List<JourneyLeg> legs;
  final int stopCount;
  final int legCount;
  final String? closeReason;
  final String? originGeofenceName;
  final DateTime? departureAt;
  final DateTime? returnAt;
  final int evidenceVersion;
  final List<JourneyPointEvidence> pointEvidence;
  final bool routeStartAnchored;
  final Map<String, dynamic>? routeStartEvidence;
  final List<JourneyRouteGap> routeGaps;
  final List<JourneyRouteSegment> routeSegments;
  final JourneyRouteCoverage routeCoverage;

  bool get hasConfirmedReturn =>
      closeReason == 'return_to_origin' &&
      originGeofenceName != null &&
      originGeofenceName!.trim().isNotEmpty;

  bool get hasInterruptedCoverage =>
      routeCoverage.interrupted || routeGaps.isNotEmpty;

  bool get hasAuthoritativeEvidence =>
      evidenceVersion >= 3 &&
      pointCount >= 2 &&
      pointEvidence.length == pointCount &&
      (!hasConfirmedReturn || routeStartAnchored);

  DateTime get confirmedDepartureAt => departureAt ?? startAt;
  DateTime get confirmedReturnAt => returnAt ?? endAt;

  Duration get totalStopDuration => stops.fold(
    Duration.zero,
    (total, stop) => total + stop.duration,
  );

  factory JourneyRecord.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final rawEvents = data['events'];
    final rawStops = data['stops'];
    final rawLegs = data['legs'];
    final rawPointEvidence = data['pointEvidence'];
    final rawRouteGaps = data['routeGaps'];
    final rawRouteSegments = data['routeSegments'];
    final rawRouteCoverage = data['routeCoverage'];

    final stops = rawStops is List
        ? rawStops
              .whereType<Map>()
              .map(
                (e) => JourneyStop.fromMap(Map<String, dynamic>.from(e)),
              )
              .toList()
        : const <JourneyStop>[];

    final legs = rawLegs is List
        ? rawLegs
              .whereType<Map>()
              .map(
                (e) => JourneyLeg.fromMap(Map<String, dynamic>.from(e)),
              )
              .toList()
        : const <JourneyLeg>[];

    return JourneyRecord(
      id: doc.id,
      startAt:
          _asDateTime(data['startAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      endAt:
          _asDateTime(data['endAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      polyline: data['polyline'] as String? ?? '',
      distanceKm: (data['distanceKm'] as num?)?.toDouble() ?? 0,
      pointCount: (data['pointCount'] as num?)?.toInt() ?? 0,
      compressed: data['compressed'] as bool? ?? true,
      events: rawEvents is List
          ? rawEvents
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
          : const [],
      stops: stops,
      legs: legs,
      stopCount: (data['stopCount'] as num?)?.toInt() ?? stops.length,
      legCount: (data['legCount'] as num?)?.toInt() ?? legs.length,
      closeReason: data['closeReason'] as String?,
      originGeofenceName: data['originGeofenceName'] as String?,
      departureAt: _asDateTime(data['departureAt']),
      returnAt: _asDateTime(data['returnAt']),
      evidenceVersion: (data['evidenceVersion'] as num?)?.toInt() ?? 0,
      pointEvidence: rawPointEvidence is List
          ? rawPointEvidence
                .whereType<Map>()
                .map(
                  (e) => JourneyPointEvidence.fromMap(
                    Map<String, dynamic>.from(e),
                  ),
                )
                .toList()
          : const [],
      routeStartAnchored: data['routeStartAnchored'] as bool? ?? false,
      routeStartEvidence: data['routeStartEvidence'] is Map
          ? Map<String, dynamic>.from(data['routeStartEvidence'] as Map)
          : null,
      routeGaps: rawRouteGaps is List
          ? rawRouteGaps
                .whereType<Map>()
                .map(
                  (e) => JourneyRouteGap.fromMap(
                    Map<String, dynamic>.from(e),
                  ),
                )
                .toList()
          : const [],
      routeSegments: rawRouteSegments is List
          ? rawRouteSegments
                .whereType<Map>()
                .map(
                  (e) => JourneyRouteSegment.fromMap(
                    Map<String, dynamic>.from(e),
                  ),
                )
                .toList()
          : const [],
      routeCoverage: rawRouteCoverage is Map
          ? JourneyRouteCoverage.fromMap(
              Map<String, dynamic>.from(rawRouteCoverage),
            )
          : const JourneyRouteCoverage(),
    );
  }
}

/// Points + merged timeline events for Journey replay.
class JourneyDayData {
  const JourneyDayData({
    required this.points,
    required this.events,
    this.dwells = const [],
    this.journeys = const [],
  });

  final List<LocationHistoryPoint> points;
  final List<JourneyEvent> events;
  final List<DwellSegment> dwells;
  final List<JourneyRecord> journeys;

  bool get isEmpty => points.isEmpty && journeys.isEmpty && dwells.isEmpty;
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

/// Journey map & sharing features.
class JourneyPhase2Features {
  const JourneyPhase2Features._();

  static const heatMap = 'Heat map overlay';
  static const share = 'Share journey';
  static const mapModes = 'Map type';
  static const aiNarration = 'Live AI narration during replay';
  static const timeMachine = 'Time Machine';
  static const dynamicMapLighting = 'Dynamic map lighting';
  static const weather = 'Typical conditions';
  static const compareMode = 'Compare mode';
  static const sharePdf = 'Share journey';
}

extension RouteSegmentColorX on RouteSegmentColor {
  Color toColor() {
    return switch (this) {
      RouteSegmentColor.green => const Color(0xFF00A551),
      RouteSegmentColor.blue => const Color(0xFF378ADD),
      RouteSegmentColor.purple => const Color(0xFF7B61FF),
    };
  }
}

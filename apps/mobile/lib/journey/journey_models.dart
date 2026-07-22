import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../models/location_history_point.dart';

enum JourneyEventType {
  leftHome,
  walking,
  vehicle,
  stopped,
  arrived,
  dwell,
}

enum TransportMode {
  stationary,
  walking,
  bicycle,
  running,
  vehicle,
}

enum RouteSegmentColor {
  green,
  blue,
  purple,
}

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
  const JourneyQuality({
    required this.fixCount,
    required this.label,
  });

  final int fixCount;
  final String label;

  String get fixesLabel => '$fixCount GPS fixes';
}

class JourneyHealth {
  const JourneyHealth({
    required this.stars,
    required this.summary,
  });

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
    this.staleGpsActive = false,
    this.isViewingToday = false,
  });

  final bool liveGpsFresh;
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

/// Compressed journey route (`devices/{imei}/journeys`).
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
  });

  final String id;
  final DateTime startAt;
  final DateTime endAt;
  final String polyline;
  final double distanceKm;
  final int pointCount;
  final bool compressed;
  final List<Map<String, dynamic>> events;

  factory JourneyRecord.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final rawEvents = data['events'];
    return JourneyRecord(
      id: doc.id,
      startAt: _asDateTime(data['startAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      endAt: _asDateTime(data['endAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      polyline: data['polyline'] as String? ?? '',
      distanceKm: (data['distanceKm'] as num?)?.toDouble() ?? 0,
      pointCount: (data['pointCount'] as num?)?.toInt() ?? 0,
      compressed: data['compressed'] as bool? ?? true,
      events: rawEvents is List
          ? rawEvents.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
          : const [],
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

  bool get isEmpty => points.isEmpty;
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

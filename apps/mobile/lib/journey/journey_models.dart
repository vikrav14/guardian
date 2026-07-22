import 'package:flutter/material.dart';

enum JourneyEventType {
  leftHome,
  walking,
  vehicle,
  stopped,
  arrived,
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

class JourneyInsights {
  const JourneyInsights({
    required this.routeSummary,
    required this.avgSpeedKmh,
    required this.gpsQualityLabel,
    required this.confidenceScore,
    required this.stopCount,
    required this.verified,
  });

  final String routeSummary;
  final double? avgSpeedKmh;
  final String gpsQualityLabel;
  final int confidenceScore;
  final int stopCount;
  final bool verified;
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

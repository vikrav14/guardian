import '../models/location_history_point.dart';
import '../safe_zones/safe_zone_logic.dart' show haversineMeters;
import 'journey_models.dart';
import 'journey_utils.dart';

class JourneyV2Route {
  const JourneyV2Route({
    required this.record,
    required this.rawPoints,
    required this.usablePoints,
    this.presentation,
    this.presentationPoints = const [],
  });

  final JourneyRecord record;
  final List<LocationHistoryPoint> rawPoints;
  final List<LocationHistoryPoint> usablePoints;
  final JourneyRoutePresentation? presentation;
  final List<LocationHistoryPoint> presentationPoints;

  int get decodedPointCount => rawPoints.length;
  int get usablePointCount => usablePoints.length;
  bool get hasReplayableRoute =>
      presentationPoints.length >= 2 || usablePoints.length >= 2;
  bool get hasPresentation => presentation != null;

  List<List<LocationHistoryPoint>> get continuousSegments {
    if (usablePoints.isEmpty) return const [];

    final segments = <List<LocationHistoryPoint>>[];
    var current = <LocationHistoryPoint>[usablePoints.first];

    for (var index = 1; index < usablePoints.length; index++) {
      final previous = usablePoints[index - 1];
      final point = usablePoints[index];
      final previousAt = previous.recordedAt;
      final pointAt = point.recordedAt;
      final trackingInterrupted =
          previousAt == null ||
          pointAt == null ||
          pointAt.difference(previousAt) > const Duration(minutes: 5);
      if (trackingInterrupted) {
        segments.add(List.unmodifiable(current));
        current = <LocationHistoryPoint>[point];
      } else {
        current.add(point);
      }
    }

    segments.add(List.unmodifiable(current));
    return List.unmodifiable(segments);
  }

  bool get matchesStoredPointCount =>
      record.pointCount <= 0 || record.pointCount == rawPoints.length;
}

List<JourneyRecord> journeyV2SortedRecords(List<JourneyRecord> journeys) {
  final sorted = List<JourneyRecord>.from(journeys)
    ..sort((a, b) => a.confirmedDepartureAt.compareTo(b.confirmedDepartureAt));
  return sorted;
}

List<JourneyRecord> journeyV2MeaningfulRecords(
  List<JourneyRecord> journeys, {
  double minimumDistanceKm = 0.02,
}) {
  return journeyV2SortedRecords(
    journeys
        .where(
          (journey) =>
              journey.hasAuthoritativeEvidence &&
              (journey.hasConfirmedReturn ||
                  journeyV2RecordedDistanceKm(journey) >= minimumDistanceKm),
        )
        .toList(),
  );
}

/// Recompute old mixed-source records as well as new records. Approximate
/// observations remain in the route evidence but add no travelled kilometres.
double journeyV2RecordedDistanceKm(JourneyRecord journey) {
  if (!journey.hasAuthoritativeEvidence) return 0;
  final coords = decodePolyline(journey.polyline);
  if (coords.length != journey.pointEvidence.length) return 0;
  var metres = 0.0;
  for (var i = 1; i < coords.length; i++) {
    final a = journey.pointEvidence[i - 1];
    final b = journey.pointEvidence[i];
    final elapsed = b.offsetMs - a.offsetMs;
    if (!a.isSatelliteObservation ||
        !b.isSatelliteObservation ||
        elapsed <= 0 ||
        elapsed > const Duration(minutes: 5).inMilliseconds) {
      continue;
    }
    if (!isPlausibleCoord(coords[i - 1].lat, coords[i - 1].lng) ||
        !isPlausibleCoord(coords[i].lat, coords[i].lng)) {
      continue;
    }
    metres += haversineMeters(
      coords[i - 1].lat,
      coords[i - 1].lng,
      coords[i].lat,
      coords[i].lng,
    );
  }
  return metres.round() / 1000;
}

JourneyRecord? journeyV2SelectRecord(
  List<JourneyRecord> journeys, {
  String? selectedId,
}) {
  final sorted = journeyV2MeaningfulRecords(journeys);
  if (sorted.isEmpty) return null;

  if (selectedId != null) {
    for (final journey in sorted) {
      if (journey.id == selectedId) return journey;
    }
  }

  return sorted.last;
}

JourneyV2Route journeyV2DecodeRecord(
  JourneyRecord record, {
  JourneyRoutePresentation? presentation,
}) {
  final usablePresentation = presentation?.isUsableAt(DateTime.now()) == true
      ? presentation
      : null;
  final presentationPoints = usablePresentation == null
      ? const <LocationHistoryPoint>[]
      : journeyV2PresentationReplayPoints(record, usablePresentation);
  final coords = decodePolyline(record.polyline);
  if (coords.isEmpty) {
    return JourneyV2Route(
      record: record,
      rawPoints: const [],
      usablePoints: const [],
      presentation: usablePresentation,
      presentationPoints: presentationPoints,
    );
  }

  final startMs = record.startAt.millisecondsSinceEpoch;
  final endMs = record.endAt.millisecondsSinceEpoch;
  final spanMs = endMs - startMs;
  final hasAlignedEvidence =
      record.evidenceVersion >= 2 &&
      record.pointEvidence.length == coords.length;

  final rawPoints = <LocationHistoryPoint>[
    for (var index = 0; index < coords.length; index++)
      LocationHistoryPoint(
        lat: coords[index].lat,
        lng: coords[index].lng,
        speedKmh: hasAlignedEvidence
            ? record.pointEvidence[index].speedKmh
            : null,
        accuracySource: hasAlignedEvidence
            ? record.pointEvidence[index].source
            : null,
        source: hasAlignedEvidence
            ? record.pointEvidence[index].source
            : null,
        gpsValid: hasAlignedEvidence
            ? record.pointEvidence[index].gpsValid
            : null,
        accuracyMeters: hasAlignedEvidence
            ? record.pointEvidence[index].accuracyMeters
            : null,
        satellites: hasAlignedEvidence
            ? record.pointEvidence[index].satellites
            : null,
        recordedAt: hasAlignedEvidence
            ? DateTime.fromMillisecondsSinceEpoch(
                startMs + record.pointEvidence[index].offsetMs,
              )
            : coords.length == 1
            ? record.startAt
            : DateTime.fromMillisecondsSinceEpoch(
                startMs + ((spanMs * index) / (coords.length - 1)).round(),
              ),
      ),
  ];

  final usablePoints = rawPoints
      .where((point) => isPlausibleCoord(point.lat, point.lng))
      .toList(growable: false);
  return JourneyV2Route(
    record: record,
    rawPoints: List.unmodifiable(rawPoints),
    usablePoints: List.unmodifiable(usablePoints),
    presentation: usablePresentation,
    presentationPoints: presentationPoints,
  );
}

List<LocationHistoryPoint> journeyV2PresentationReplayPoints(
  JourneyRecord record,
  JourneyRoutePresentation presentation, {
  int maxPointsPerSegment = 24,
}) {
  final output = <LocationHistoryPoint>[];
  for (final segment in presentation.segments) {
    final coordinates = decodePolyline(segment.polyline);
    if (coordinates.length < 2) continue;
    final step = coordinates.length <= maxPointsPerSegment
        ? 1
        : ((coordinates.length - 1) / (maxPointsPerSegment - 1)).ceil();
    final indexes = <int>[
      for (var index = 0; index < coordinates.length; index += step) index,
      if ((coordinates.length - 1) % step != 0) coordinates.length - 1,
    ];

    for (final coordinateIndex in indexes) {
      final coordinate = coordinates[coordinateIndex];
      final ratio = coordinateIndex / (coordinates.length - 1);
      final offsetMs = segment.fromOffsetMs +
          ((segment.toOffsetMs - segment.fromOffsetMs) * ratio).round();
      final sourcePointIndex = segment.fromPointIndex +
          ((segment.toPointIndex - segment.fromPointIndex) * ratio).round();
      final point = LocationHistoryPoint(
        lat: coordinate.lat,
        lng: coordinate.lng,
        source: segment.source,
        accuracySource: segment.source,
        gpsValid: segment.source == 'gps',
        recordedAt: record.startAt.add(Duration(milliseconds: offsetMs)),
        sourcePointIndex: sourcePointIndex,
      );
      final previous = output.isEmpty ? null : output.last;
      final duplicate = previous != null &&
          (previous.lat - point.lat).abs() < 0.0000001 &&
          (previous.lng - point.lng).abs() < 0.0000001 &&
          previous.recordedAt == point.recordedAt;
      if (!duplicate) output.add(point);
    }
  }
  return List.unmodifiable(output);
}

import '../models/location_history_point.dart';
import 'journey_models.dart';
import 'journey_utils.dart';

class JourneyV2Route {
  const JourneyV2Route({
    required this.record,
    required this.rawPoints,
    required this.usablePoints,
  });

  final JourneyRecord record;
  final List<LocationHistoryPoint> rawPoints;
  final List<LocationHistoryPoint> usablePoints;

  int get decodedPointCount => rawPoints.length;
  int get usablePointCount => usablePoints.length;
  bool get hasReplayableRoute => usablePoints.length >= 2;

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
    ..sort(
      (a, b) =>
          a.confirmedDepartureAt.compareTo(b.confirmedDepartureAt),
    );
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
                  journey.distanceKm >= minimumDistanceKm),
        )
        .toList(),
  );
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

JourneyV2Route journeyV2DecodeRecord(JourneyRecord record) {
  final coords = decodePolyline(record.polyline);
  if (coords.isEmpty) {
    return JourneyV2Route(
      record: record,
      rawPoints: const [],
      usablePoints: const [],
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
  );
}

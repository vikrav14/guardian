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

  bool get matchesStoredPointCount =>
      record.pointCount <= 0 || record.pointCount == rawPoints.length;
}

List<JourneyRecord> journeyV2SortedRecords(List<JourneyRecord> journeys) {
  final sorted = List<JourneyRecord>.from(journeys)
    ..sort((a, b) => a.startAt.compareTo(b.startAt));
  return sorted;
}

List<JourneyRecord> journeyV2MeaningfulRecords(
  List<JourneyRecord> journeys, {
  double minimumDistanceKm = 0.02,
}) {
  return journeyV2SortedRecords(
    journeys
        .where((journey) => journey.distanceKm >= minimumDistanceKm)
        .toList(),
  );
}

JourneyRecord? journeyV2SelectRecord(
  List<JourneyRecord> journeys, {
  String? selectedId,
}) {
  if (journeys.isEmpty) return null;

  final sorted = journeyV2SortedRecords(journeys);

  if (selectedId != null) {
    for (final journey in sorted) {
      if (journey.id == selectedId) return journey;
    }
  }

  final meaningful = journeyV2MeaningfulRecords(sorted);
  if (meaningful.isNotEmpty) return meaningful.last;

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

  final rawPoints = <LocationHistoryPoint>[
    for (var index = 0; index < coords.length; index++)
      LocationHistoryPoint(
        lat: coords[index].lat,
        lng: coords[index].lng,
        recordedAt: coords.length == 1
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

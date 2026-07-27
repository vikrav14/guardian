import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:guardian/journey/journey_replay_controller.dart';
import 'package:guardian/journey/ui/journey_map_markers.dart';
import 'package:guardian/models/location_history_point.dart';

JourneyReplayController _replay() {
  return JourneyReplayController(
    rawPoints: [
      LocationHistoryPoint(
        lat: -20.024,
        lng: 57.591,
        recordedAt: DateTime(2026, 7, 24, 15),
      ),
      LocationHistoryPoint(
        lat: -20.026,
        lng: 57.594,
        recordedAt: DateTime(2026, 7, 24, 15, 5),
      ),
      LocationHistoryPoint(
        lat: -20.029,
        lng: 57.597,
        recordedAt: DateTime(2026, 7, 24, 15, 10),
      ),
    ],
  );
}

void main() {
  test('completed route keeps event markers and no replay cursor', () {
    final replay = _replay();
    addTearDown(replay.dispose);

    final ids = buildJourneyColoredMarkers(
      replay,
    ).map((marker) => marker.markerId.value);

    expect(ids, containsAll(<String>['start', 'end']));
    expect(ids, isNot(contains('replay')));
  });

  test('replay uses the tracked person avatar instead of the old cursor', () {
    final replay = _replay()..enterReplayMode();
    addTearDown(replay.dispose);
    final avatar =
        BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet);

    final markers = buildJourneyColoredMarkers(
      replay,
      replayAvatarIcon: avatar,
    );
    final replayMarker = markers.singleWhere(
      (marker) => marker.markerId.value == 'replay',
    );

    expect(replayMarker.icon, avatar);
    expect(replayMarker.rotation, 0);
    expect(replayMarker.flat, isFalse);
    expect(
      markers.map((marker) => marker.markerId.value),
      isNot(contains('end')),
    );
  });
}

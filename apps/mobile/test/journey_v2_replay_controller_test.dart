import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_v2_replay_controller.dart';
import 'package:guardian/models/location_history_point.dart';

void main() {
  List<LocationHistoryPoint> points() {
    final start = DateTime(2026, 8, 10, 16, 50);
    return [
      LocationHistoryPoint(lat: -20.16196, lng: 57.64834, recordedAt: start),
      LocationHistoryPoint(
        lat: -20.10,
        lng: 57.62,
        recordedAt: start.add(const Duration(minutes: 20)),
      ),
      LocationHistoryPoint(
        lat: -20.02917,
        lng: 57.59590,
        recordedAt: start.add(const Duration(minutes: 45)),
      ),
    ];
  }

  testWidgets('play advances and pauses the replay', (tester) async {
    final replay = JourneyV2ReplayController(points: points());
    addTearDown(replay.dispose);

    expect(replay.currentIndex, 0);
    expect(replay.isPlaying, isFalse);

    replay.play();
    expect(replay.isPlaying, isTrue);

    await tester.pump(const Duration(milliseconds: 540));
    expect(replay.currentIndex, 1);

    replay.pause();
    final pausedAt = replay.currentIndex;
    await tester.pump(const Duration(seconds: 1));

    expect(replay.isPlaying, isFalse);
    expect(replay.currentIndex, pausedAt);
  });

  test('seek and speed controls update deterministically', () {
    final replay = JourneyV2ReplayController(points: points());
    addTearDown(replay.dispose);

    replay.seekProgress(1);
    expect(replay.currentIndex, 2);
    expect(replay.currentTime, DateTime(2026, 8, 10, 17, 35));

    expect(replay.speedLabel, '1x');
    replay.cycleSpeed();
    expect(replay.speedLabel, '2x');
    replay.cycleSpeed();
    expect(replay.speedLabel, '4x');
    replay.cycleSpeed();
    expect(replay.speedLabel, '1x');
  });
}

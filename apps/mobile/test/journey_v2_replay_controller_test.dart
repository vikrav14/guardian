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
    final replay = JourneyV2ReplayController(
      points: points(),
      replayDuration: const Duration(milliseconds: 900),
    );
    addTearDown(replay.dispose);

    expect(replay.currentIndex, 0);
    expect(replay.isPlaying, isFalse);

    replay.play();
    expect(replay.isPlaying, isTrue);

    await tester.pump(const Duration(milliseconds: 420));
    expect(replay.currentIndex, 1);

    replay.pause();
    final pausedAt = replay.currentIndex;
    await tester.pump(const Duration(seconds: 1));

    expect(replay.isPlaying, isFalse);
    expect(replay.currentIndex, pausedAt);
  });

  test('default 1x replay is paced from the recorded journey duration', () {
    final start = DateTime(2026, 8, 17, 15, 30, 27);
    final replay = JourneyV2ReplayController(
      points: [
        LocationHistoryPoint(lat: -20.02, lng: 57.59, recordedAt: start),
        LocationHistoryPoint(
          lat: -20.03,
          lng: 57.60,
          recordedAt: start.add(const Duration(seconds: 160)),
        ),
      ],
    );
    addTearDown(replay.dispose);

    expect(replay.speedLabel, '1x');
    expect(replay.replayDuration.inMilliseconds, 26667);

    replay.cycleSpeed();
    expect(replay.speedLabel, '2x');
    expect(replay.replayDuration.inMilliseconds, 13334);
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

  test('progress follows recorded time rather than equal point spacing', () {
    final replay = JourneyV2ReplayController(points: points());
    addTearDown(replay.dispose);

    replay.seekProgress(0.45);
    expect(replay.currentIndex, 1);
    expect(replay.progress, closeTo(20 / 45, 0.0001));

    replay.seekProgress(0.9);
    expect(replay.currentIndex, 2);
    expect(replay.progress, 1);
  });

  test('a tapped map point seeks replay to the matching evidence', () {
    final replay = JourneyV2ReplayController(points: points());
    addTearDown(replay.dispose);

    replay.seekIndex(1);
    expect(replay.currentIndex, 1);
    expect(replay.currentTime, DateTime(2026, 8, 10, 17, 10));

    replay.seekIndex(99);
    expect(replay.currentIndex, 2);
  });

  test('missing recorded times fall back to deterministic point progress', () {
    final replay = JourneyV2ReplayController(
      points: const [
        LocationHistoryPoint(lat: -20.1, lng: 57.5),
        LocationHistoryPoint(lat: -20.2, lng: 57.6),
        LocationHistoryPoint(lat: -20.3, lng: 57.7),
      ],
    );
    addTearDown(replay.dispose);

    replay.seekProgress(0.5);
    expect(replay.currentIndex, 1);
    expect(replay.progress, 0.5);
  });

  testWidgets('a long tracking gap is announced and automatically compressed', (
    tester,
  ) async {
    final start = DateTime(2026, 8, 19, 18, 31);
    final replay = JourneyV2ReplayController(
      points: [
        LocationHistoryPoint(lat: -20.1, lng: 57.5, recordedAt: start),
        LocationHistoryPoint(
          lat: -20.2,
          lng: 57.6,
          recordedAt: start.add(const Duration(minutes: 42)),
        ),
        LocationHistoryPoint(
          lat: -20.21,
          lng: 57.61,
          recordedAt: start.add(const Duration(minutes: 43)),
        ),
      ],
      replayDuration: const Duration(seconds: 30),
    );
    addTearDown(replay.dispose);

    expect(replay.pendingTrackingGap, const Duration(minutes: 42));
    replay.play();
    expect(replay.isSkippingTrackingGap, isTrue);

    await tester.pump(const Duration(milliseconds: 1250));
    expect(replay.currentIndex, 1);
    expect(replay.isSkippingTrackingGap, isFalse);
    replay.pause();
  });
}

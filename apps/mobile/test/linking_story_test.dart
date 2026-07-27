import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/linking_story.dart';
import 'package:guardian/models/device.dart';

void main() {
  test('linking story starts with waking step', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'connecting',
      connectingAt: now,
    );

    expect(linkingStoryStep(device, now: now), 1);
    final metrics = linkingStoryMetrics(device, now: now);
    expect(metrics[0].label, 'Pendant awake');
    expect(metrics[1].label, anyOf('Securing link', 'Making contact'));
    expect(metrics[1].state, LinkingStoryMetricState.active);
    expect(metrics[2].label, 'Location waiting');
    expect(metrics[3].label, 'Battery waiting');
  });

  test('linking story advances after session heartbeat', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: now,
      lastHeartbeatAt: now.add(const Duration(seconds: 2)),
    );

    expect(
      linkingStoryStep(device, now: now.add(const Duration(seconds: 2))),
      2,
    );
    final metrics = linkingStoryMetrics(
      device,
      now: now.add(const Duration(seconds: 2)),
    );
    expect(metrics[1].label, 'Network ready');
    expect(metrics[1].state, LinkingStoryMetricState.complete);
    expect(metrics[2].state, LinkingStoryMetricState.active);
    expect(metrics[3].state, LinkingStoryMetricState.active);
  });

  test('linking cards report approximate location and battery evidence', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: now,
      lastHeartbeatAt: now,
      batteryPercent: 76,
      accuracySource: 'wifi',
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
    );

    final metrics = linkingStoryMetrics(device, now: now);
    expect(metrics[2].label, 'Approx. location');
    expect(metrics[2].state, LinkingStoryMetricState.complete);
    expect(metrics[3].label, '76% battery');
    expect(metrics[3].state, LinkingStoryMetricState.complete);
  });

  test('linking guardian insight rotates copy', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'connecting',
      connectingAt: now,
    );

    final first = linkingGuardianInsight(device, now: now, tick: 0);
    final second = linkingGuardianInsight(device, now: now, tick: 1);
    expect(first.title, isNot(equals(second.title)));
    expect(first.detail, isNotEmpty);
  });

  test('linking guardian adds reassurance after 20 seconds', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'connecting',
      connectingAt: now.subtract(const Duration(seconds: 25)),
    );

    final messages = [
      for (var i = 0; i < 8; i++)
        linkingGuardianInsight(
          device,
          now: now,
          tick: i,
        ).detail,
    ];
    expect(
      messages,
      anyElement(contains('Indoors can take a bit longer')),
    );
  });
}

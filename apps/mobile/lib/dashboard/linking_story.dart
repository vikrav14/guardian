import 'package:flutter/material.dart';

import '../models/device.dart';
import 'dashboard_insight.dart';
import 'device_connectivity.dart';

/// How long each Guardian AI linking message stays on screen.
const linkingMessageHold = Duration(seconds: 6);

/// Progress through the power-on narrative (0 = waking, 3 = almost live).
int linkingStoryStep(Device device, {DateTime? now}) {
  if (!device.isReconnecting) return -1;

  if (deviceHasSessionHeartbeat(device)) {
    if (device.hasFreshLocation || device.hasApproximateLocation) {
      return 3;
    }
    return 2;
  }

  if (deviceIsHandshaking(device, now: now) ||
      device.connectionState == 'connecting') {
    return 1;
  }

  return 0;
}

Duration linkingElapsed(Device device, {DateTime? now}) {
  final started = device.connectingAt ?? device.updatedAt;
  if (started == null) return Duration.zero;
  return (now ?? DateTime.now()).difference(started);
}

enum LinkingStoryMetricState { pending, active, complete }

class LinkingStoryMetric {
  const LinkingStoryMetric({
    required this.label,
    required this.icon,
    required this.state,
  });

  final String label;
  final IconData icon;
  final LinkingStoryMetricState state;
}

List<LinkingStoryMetric> linkingStoryMetrics(
  Device device, {
  DateTime? now,
  int tick = 0,
}) {
  final step = linkingStoryStep(device, now: now);
  final name = device.displayName;
  final battery = device.batteryPercent;
  final variant = tick % 2;

  LinkingStoryMetricState stateFor(int metricStep) {
    if (step > metricStep) return LinkingStoryMetricState.complete;
    if (step == metricStep) return LinkingStoryMetricState.active;
    return LinkingStoryMetricState.pending;
  }

  final wakeLabel = step >= 1
      ? 'Awake'
      : (variant == 0 ? 'Waking $name' : 'Checking in');

  final linkLabel = switch (step) {
    >= 2 => 'Secure link',
    1 => (variant == 0 ? 'Connecting' : 'Making contact'),
    _ => 'Waiting',
  };

  final locationLabel = battery != null
      ? '$battery%'
      : switch (step) {
          >= 3 => 'Ready',
          2 => (variant == 0 ? 'Finding $name' : 'Searching'),
          _ => '—',
        };

  final readyLabel = switch (step) {
    3 => (variant == 0 ? 'Almost there' : 'Ready soon'),
    >= 2 => 'Preparing',
    1 => 'Listening',
    _ => 'Stand by',
  };

  return [
    LinkingStoryMetric(
      label: wakeLabel,
      icon: step >= 1 ? Icons.wb_sunny_outlined : Icons.bedtime_outlined,
      state: stateFor(0),
    ),
    LinkingStoryMetric(
      label: linkLabel,
      icon: step >= 2 ? Icons.lock_outline_rounded : Icons.wifi_tethering_rounded,
      state: stateFor(1),
    ),
    LinkingStoryMetric(
      label: locationLabel,
      icon: battery != null
          ? Icons.battery_5_bar_rounded
          : Icons.explore_outlined,
      state: step >= 2 ? LinkingStoryMetricState.active : stateFor(2),
    ),
    LinkingStoryMetric(
      label: readyLabel,
      icon: step >= 3 ? Icons.favorite_outline_rounded : Icons.radar_rounded,
      state: stateFor(3),
    ),
  ];
}

String? _linkingReassurance(Duration elapsed) {
  final seconds = elapsed.inSeconds;
  if (seconds >= 90) {
    return 'This can take a little while after power-on. I’m still here with you.';
  }
  if (seconds >= 60) {
    return 'We’re connected — just waiting for a clear location.';
  }
  if (seconds >= 40) {
    return 'Still working on it. Nothing to worry about.';
  }
  if (seconds >= 20) {
    return 'Indoors can take a bit longer. Hang tight.';
  }
  return null;
}

DashboardInsight linkingGuardianInsight(
  Device device, {
  DateTime? now,
  int tick = 0,
}) {
  final name = device.displayName;
  final elapsed = linkingElapsed(device, now: now);
  final step = linkingStoryStep(device, now: now);
  // One message per hold interval — give people time to read.
  final rotation = tick;

  final reassurance = _linkingReassurance(elapsed);

  final titles = switch (step) {
    0 => [
        "Hi — I’m checking on $name.",
        "Let’s see how $name is doing.",
        'One moment while I wake the pendant…',
      ],
    1 => [
        "I can hear $name’s pendant.",
        'Getting a secure connection ready…',
        'Signal looks good so far.',
      ],
    2 => [
        'Looking for $name…',
        'Finding the best location signal…',
        'Still waiting for the first location…',
      ],
    _ => [
        'Almost there!',
        'Everything looks good so far.',
        'Preparing the first location update…',
      ],
  };

  var details = switch (step) {
    0 => [
        'The pendant has just come on.',
        'Waking things up gently…',
        'Making sure everything is ready…',
        'Connecting to Guardian…',
      ],
    1 => [
        'Linking up with the pendant now.',
        'This usually only takes a moment.',
        'Stay with me — we’re getting there.',
      ],
    2 => [
        'Location can take a few moments, especially indoors.',
        'Searching for a clear signal nearby…',
        'Hang tight — a location update is on the way.',
      ],
    _ => [
        'Connection looks solid — finishing up now.',
        'Almost ready to show you where $name is.',
        'Good news is coming…',
      ],
  };

  if (reassurance != null) {
    details = [...details, reassurance];
  }

  return DashboardInsight(
    title: titles[rotation % titles.length],
    detail: details[rotation % details.length],
    tone: DashboardInsightTone.neutral,
  );
}

DashboardInsight buildDashboardInsightForDevice(
  Device? device, {
  DateTime? now,
  int linkingTick = 0,
}) {
  if (device == null) {
    return const DashboardInsight(
      title: 'Connect a device to begin',
      detail: 'Guardian AI will summarize location, battery, and movement signals here.',
      tone: DashboardInsightTone.neutral,
    );
  }

  if (device.isReconnecting) {
    return linkingGuardianInsight(device, now: now, tick: linkingTick);
  }

  return buildDashboardInsight(device);
}

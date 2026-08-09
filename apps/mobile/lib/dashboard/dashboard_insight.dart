import '../models/device.dart';
import 'device_connectivity.dart';
import 'linking_story.dart';

enum DashboardInsightTone { safe, warning, danger, neutral }

class DashboardInsight {
  const DashboardInsight({
    required this.title,
    required this.detail,
    required this.tone,
  });

  final String title;
  final String detail;
  final DashboardInsightTone tone;
}

DashboardInsightTone _toneForLevel(String level) {
  return switch (level.toLowerCase()) {
    'urgent' => DashboardInsightTone.danger,
    'warning' => DashboardInsightTone.warning,
    _ => DashboardInsightTone.neutral,
  };
}

String _titleForInsight(String id, Device device) {
  return switch (id) {
    'offline' =>
      device.location?.isValid == true
          ? 'Last known location may be outdated'
          : 'Device not reachable',
    'low_battery_moving' => 'Low battery while moving',
    'stale_gps' =>
      device.hasApproximateLocation
          ? 'Approximate location may be outdated'
          : 'Location may be outdated',
    'geofence_exit_urgent' => 'Outside home zone',
    'battery_forecast' => 'Battery forecast',
    _ => 'Safety insight',
  };
}

DashboardInsight _fromIntelligence(
  DeviceIntelligence intelligence,
  Device device,
) {
  final top = intelligence.topInsight;
  if (top == null || top.confidence < top.suppressBelow) {
    return const DashboardInsight(
      title: 'Monitoring signals',
      detail: 'Unable to determine with confidence. Continue monitoring.',
      tone: DashboardInsightTone.neutral,
    );
  }

  return DashboardInsight(
    title: _titleForInsight(top.id, device),
    detail: _detailForInsight(top.id, device, top.inference),
    tone: _toneForLevel(top.level),
  );
}

String _friendlyAgeLabel(Duration age) {
  if (age.inMinutes < 1) return 'just now';
  if (age.inMinutes < 60) {
    final m = age.inMinutes;
    return m == 1 ? '1 minute ago' : '$m minutes ago';
  }
  final h = age.inHours;
  if (h < 24) return h == 1 ? 'about 1 hour ago' : 'about $h hours ago';
  final d = age.inDays;
  return d == 1 ? 'yesterday' : '$d days ago';
}

String _offlineLocationDetail(Device device) {
  final recorded = device.location?.recordedAt;
  if (device.location?.isValid != true || recorded == null) {
    return 'We can’t see a live location right now. Check the watch is on, charged, and has coverage.';
  }

  final ageLabel = _friendlyAgeLabel(DateTime.now().difference(recorded));
  final approximate = device.hasApproximateLocation;
  final precisionNote = approximate
      ? ' The last fix was approximate, so the pin may be a little off.'
      : '';

  return 'Last seen $ageLabel. The map shows their last known place — they may have moved since then.$precisionNote';
}

String _detailForInsight(String id, Device device, String inference) {
  return switch (id) {
    'stale_gps' => () {
      final recorded = device.location?.recordedAt;
      if (recorded == null) {
        return 'Still waiting for a clear location from the pendant.';
      }
      final age = _friendlyAgeLabel(DateTime.now().difference(recorded));
      final approx = device.hasApproximateLocation
          ? ' It was approximate, so the pin may be a little off.'
          : '';
      return 'Last saw them $age.$approx The map may be a little behind until a fresher update arrives.';
    }(),
    'offline' => _offlineLocationDetail(device),
    _ => inference,
  };
}

DashboardInsight _fallbackClientInsight(Device device) {
  final now = DateTime.now();
  final lastHeartbeat = device.lastHeartbeatAt;
  if (lastHeartbeat != null) {
    final offlineMinutes = now.difference(lastHeartbeat).inMinutes;
    if (offlineMinutes >= 10 && device.online) {
      return DashboardInsight(
        title: device.location?.isValid == true
            ? 'Last known location may be outdated'
            : 'Device not reachable',
        detail: _offlineLocationDetail(device),
        tone: DashboardInsightTone.danger,
      );
    }
  }

  final battery = device.batteryPercent;
  final speed = device.speedKmh ?? 0;
  if (battery != null && battery < 10 && speed > 1 && device.hasFreshLocation) {
    return DashboardInsight(
      title: 'Low battery while moving',
      detail:
          'Battery at $battery% while moving at ${speed.toStringAsFixed(1)} km/h.',
      tone: DashboardInsightTone.warning,
    );
  }

  if (!device.hasFreshLocation && device.online) {
    final recorded = device.location?.recordedAt;
    if (recorded != null) {
      final ageMinutes = now.difference(recorded).inMinutes;
      if (ageMinutes > 8) {
        final age = _friendlyAgeLabel(Duration(minutes: ageMinutes));
        final approx = device.hasApproximateLocation
            ? ' The last update was approximate.'
            : '';
        return DashboardInsight(
          title: 'Location may be outdated',
          detail:
              'Last saw them $age.$approx Waiting for a fresher update from the pendant.',
          tone: DashboardInsightTone.warning,
        );
      }
    }
    return const DashboardInsight(
      title: 'Waiting for a location',
      detail:
          'The watch is connected. Looking for a clear position update now.',
      tone: DashboardInsightTone.warning,
    );
  }

  if ((device.batteryPercent ?? 100) <= 20) {
    return DashboardInsight(
      title: 'Battery needs attention',
      detail:
          '${device.displayName} has ${device.batteryPercent}% battery remaining.',
      tone: DashboardInsightTone.warning,
    );
  }

  if (device.hasApproximateLocation) {
    return DashboardInsight(
      title: 'Approximate location only',
      detail:
          'We have a rough idea of where they are. A clearer fix usually arrives outdoors with open sky.',
      tone: DashboardInsightTone.neutral,
    );
  }

  return const DashboardInsight(
    title: 'Everything looks normal',
    detail: 'Connected, battery looks fine, and we have a clear location.',
    tone: DashboardInsightTone.safe,
  );
}

DashboardInsight buildDashboardInsight(Device? device) {
  if (device == null) {
    return const DashboardInsight(
      title: 'Connect a device to begin',
      detail:
          'Guardian AI will summarize location, battery, and movement signals here.',
      tone: DashboardInsightTone.neutral,
    );
  }

  if (device.isReconnecting) {
    return linkingGuardianInsight(device);
  }

  final intelligence = device.intelligence;
  if (intelligence != null && intelligence.insights.isNotEmpty) {
    return _fromIntelligence(intelligence, device);
  }

  if (!device.online) {
    if (device.isTrulyOffline) {
      return DashboardInsight(
        title: device.location?.isValid == true
            ? 'Last known location may be outdated'
            : '${device.displayName} is offline',
        detail: _offlineLocationDetail(device),
        tone: DashboardInsightTone.danger,
      );
    }
  }

  return _fallbackClientInsight(device);
}

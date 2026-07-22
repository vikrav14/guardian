import '../models/device.dart';

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

DashboardInsight _fromIntelligence(DeviceIntelligence intelligence) {
  final top = intelligence.topInsight;
  if (top == null || top.confidence < top.suppressBelow) {
    return const DashboardInsight(
      title: 'Monitoring signals',
      detail: 'Unable to determine with confidence. Continue monitoring.',
      tone: DashboardInsightTone.neutral,
    );
  }

  final title = switch (top.id) {
    'offline' => 'Device may be offline',
    'low_battery_moving' => 'Low battery while moving',
    'stale_gps' => 'GPS data may be stale',
    'geofence_exit_urgent' => 'Outside home zone',
    'battery_forecast' => 'Battery forecast',
    _ => 'Safety insight',
  };

  return DashboardInsight(
    title: title,
    detail: top.inference,
    tone: _toneForLevel(top.level),
  );
}

DashboardInsight _fallbackClientInsight(Device device) {
  final now = DateTime.now();
  final lastHeartbeat = device.lastHeartbeatAt;
  if (lastHeartbeat != null) {
    final offlineMinutes = now.difference(lastHeartbeat).inMinutes;
    if (offlineMinutes >= 10 && device.online) {
      return DashboardInsight(
        title: 'Device may be offline',
        detail:
            'No heartbeat for $offlineMinutes minutes (last at ${lastHeartbeat.toIso8601String()}).',
        tone: DashboardInsightTone.danger,
      );
    }
  }

  final battery = device.batteryPercent;
  final speed = device.speedKmh ?? 0;
  if (battery != null && battery < 10 && speed > 1 && device.hasFreshLocation) {
    return DashboardInsight(
      title: 'Low battery while moving',
      detail: 'Battery at $battery% while moving at ${speed.toStringAsFixed(1)} km/h.',
      tone: DashboardInsightTone.warning,
    );
  }

  if (!device.hasFreshLocation && device.online) {
    final recorded = device.location?.recordedAt;
    if (recorded != null) {
      final ageMinutes = now.difference(recorded).inMinutes;
      if (ageMinutes > 8) {
        return DashboardInsight(
          title: 'GPS data may be stale',
          detail:
              'Last GPS fix is $ageMinutes minutes old (recorded ${recorded.toIso8601String()}).',
          tone: DashboardInsightTone.warning,
        );
      }
    }
    return const DashboardInsight(
      title: 'Waiting for a GPS position',
      detail: 'The pendant is connected, but a valid location has not arrived yet.',
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

  return const DashboardInsight(
    title: 'Everything looks normal',
    detail: 'Device connected • Battery sufficient • GPS position available',
    tone: DashboardInsightTone.safe,
  );
}

DashboardInsight buildDashboardInsight(Device? device) {
  if (device == null) {
    return const DashboardInsight(
      title: 'Connect a device to begin',
      detail: 'Guardian AI will summarize location, battery, and movement signals here.',
      tone: DashboardInsightTone.neutral,
    );
  }

  final intelligence = device.intelligence;
  if (intelligence != null && intelligence.insights.isNotEmpty) {
    return _fromIntelligence(intelligence);
  }

  if (!device.online) {
    return DashboardInsight(
      title: '${device.displayName} is offline',
      detail: 'Live safety signals are unavailable. Check the pendant and its connection.',
      tone: DashboardInsightTone.danger,
    );
  }

  return _fallbackClientInsight(device);
}

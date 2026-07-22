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

DashboardInsight buildDashboardInsight(Device? device) {
  if (device == null) {
    return const DashboardInsight(
      title: 'Connect a device to begin',
      detail: 'Guardian AI will summarize location, battery, and movement signals here.',
      tone: DashboardInsightTone.neutral,
    );
  }
  if (!device.online) {
    return DashboardInsight(
      title: '${device.displayName} is offline',
      detail: 'Live safety signals are unavailable. Check the pendant and its connection.',
      tone: DashboardInsightTone.danger,
    );
  }
  if ((device.batteryPercent ?? 100) <= 20) {
    return DashboardInsight(
      title: 'Battery needs attention',
      detail: '${device.displayName} has ${device.batteryPercent}% battery remaining.',
      tone: DashboardInsightTone.warning,
    );
  }
  if (!device.hasFreshLocation) {
    return const DashboardInsight(
      title: 'Waiting for a GPS position',
      detail: 'The pendant is connected, but a valid location has not arrived yet.',
      tone: DashboardInsightTone.warning,
    );
  }
  return const DashboardInsight(
    title: 'Everything looks normal',
    detail: 'Device connected • Battery sufficient • GPS position available',
    tone: DashboardInsightTone.safe,
  );
}

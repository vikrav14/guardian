import '../models/alert.dart';
import '../models/device.dart';
import 'dashboard_insight.dart';

/// Whether the floating map card should stay visible (not dismissible quietly).
bool deviceNeedsMapCardAttention(
  Device device, {
  List<GuardianAlert> alerts = const [],
}) {
  final insight = buildDashboardInsight(device);
  if (insight.tone == DashboardInsightTone.danger ||
      insight.tone == DashboardInsightTone.warning) {
    return true;
  }
  for (final alert in alerts) {
    if (alert.resolved) continue;
    final type = alert.type.toLowerCase();
    if (type == 'sos' ||
        type == 'fall' ||
        type == 'geofence_exit' ||
        type == 'low_battery') {
      return true;
    }
  }
  return false;
}

/// True when the device is connected, charged, and located — safe to minimize.
bool deviceMapCardStatusNormal(
  Device device, {
  List<GuardianAlert> alerts = const [],
}) {
  return buildDashboardInsight(device).tone == DashboardInsightTone.safe &&
      !deviceNeedsMapCardAttention(device, alerts: alerts);
}

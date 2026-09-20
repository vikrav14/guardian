import '../services/guardian_entitlements.dart';

const _mauritiusOffset = Duration(hours: 4);

DateTime wellnessDayStart(DateTime value) {
  final local = value.toUtc().add(_mauritiusOffset);
  return DateTime.utc(
    local.year,
    local.month,
    local.day,
  ).subtract(_mauritiusOffset);
}

String wellnessDateKey(DateTime value) =>
    value.toUtc().add(_mauritiusOffset).toIso8601String().substring(0, 10);

class WellnessWindow {
  const WellnessWindow(this.start, this.end);
  final DateTime start;
  final DateTime end;

  factory WellnessWindow.forSubscription(
    GuardianSubscription subscription, {
    required DateTime now,
    DateTime? before,
    int days = 7,
  }) {
    if (!subscription.serviceActive ||
        subscription.plan == null ||
        (subscription.accessUntil != null &&
            !subscription.accessUntil!.isAfter(now))) {
      throw StateError('An active Guardian subscription is required.');
    }
    final tomorrow = wellnessDayStart(now).add(const Duration(days: 1));
    final maximum = subscription.plan == GuardianPlan.essential
        ? 1
        : subscription.plan == GuardianPlan.family
        ? 7
        : 31;
    final end = before != null && before.isBefore(tomorrow)
        ? wellnessDayStart(before)
        : tomorrow;
    final count = days.clamp(1, maximum);
    final start = end.subtract(Duration(days: count));
    if (subscription.plan != GuardianPlan.care &&
        start.isBefore(tomorrow.subtract(Duration(days: maximum)))) {
      throw StateError('This date is outside the edition history window.');
    }
    return WellnessWindow(start, end);
  }

  bool contains(DateTime value, {required DateTime now}) =>
      !value.isBefore(start) && value.isBefore(end) && !value.isAfter(now);

  bool includesDate(String date) =>
      date.compareTo(wellnessDateKey(start)) >= 0 &&
      date.compareTo(wellnessDateKey(end)) < 0;
}

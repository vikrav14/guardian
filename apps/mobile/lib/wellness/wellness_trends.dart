import 'package:intl/intl.dart';
import '../models/activity_day.dart';
import 'wellness_sample.dart';
import 'wellness_window.dart';

extension WellnessMetricPresentation on WellnessMetric {
  String get label => switch (this) {
    WellnessMetric.heartRate => 'Heart rate',
    WellnessMetric.bloodOxygen => 'Blood oxygen',
    WellnessMetric.bloodPressure => 'Blood pressure',
    WellnessMetric.skinTemperature => 'Skin temperature',
  };
  String get unit => switch (this) {
    WellnessMetric.heartRate => 'bpm',
    WellnessMetric.bloodOxygen => '%',
    WellnessMetric.bloodPressure => 'mmHg',
    WellnessMetric.skinTemperature => '°C',
  };
  String format(num value) => this == WellnessMetric.skinTemperature
      ? value.toStringAsFixed(2)
      : NumberFormat.decimalPattern().format(value);
}

/// Presentation-only selection over records already authorized by the service.
/// No inferred readings, medical classifications or time-weighted averages.
class WellnessTrend {
  WellnessTrend({
    required this.metric,
    required this.window,
    required List<WellnessSample> samples,
    required DateTime now,
  }) : readings =
           samples
               .where(
                 (s) =>
                     s.metric == metric &&
                     window.contains(s.recordedAt, now: now),
               )
               .toList()
             ..sort((a, b) => a.recordedAt.compareTo(b.recordedAt));

  final WellnessMetric metric;
  final WellnessWindow window;
  final List<WellnessSample> readings;
  List<WellnessSample> get points => readings.where((s) => s.canPlot).toList();
  WellnessSample? get latest => readings.lastOrNull;
  int get daysWithReadings =>
      readings.map((s) => wellnessDateKey(s.recordedAt)).toSet().length;
  int get daysInWindow => window.end.difference(window.start).inDays;

  String? get range {
    final values = points.map((s) => s.numericValue!).toList();
    if (values.isEmpty || metric == WellnessMetric.bloodPressure) return null;
    values.sort();
    return '${metric.format(values.first)}–${metric.format(values.last)} ${metric.unit}';
  }
}

List<ActivityDay> wellnessActivityDays({
  required List<ActivityDay> days,
  required WellnessWindow window,
  required DateTime now,
}) {
  // A late update or duplicate must not produce two bars for the same day.
  final byDate = <String, ActivityDay>{};
  for (final day in days) {
    if (!window.includesDate(day.localDate) ||
        day.steps < 0 ||
        !window.contains(day.lastObservedAt, now: now)) {
      continue;
    }
    final previous = byDate[day.localDate];
    if (previous == null ||
        day.lastObservedAt.isAfter(previous.lastObservedAt)) {
      byDate[day.localDate] = day;
    }
  }
  return byDate.values.toList()
    ..sort((a, b) => a.localDate.compareTo(b.localDate));
}

String wellnessLocalTime(DateTime at) =>
    DateFormat('d MMM, HH:mm').format(at.toUtc().add(const Duration(hours: 4)));

String wellnessPeriodLabel(WellnessWindow window) {
  final start = window.start.toUtc().add(const Duration(hours: 4));
  final end = window.end
      .subtract(const Duration(days: 1))
      .toUtc()
      .add(const Duration(hours: 4));
  return window.end.difference(window.start).inDays == 1
      ? DateFormat('d MMMM yyyy').format(start)
      : '${DateFormat('d MMM').format(start)} – ${DateFormat('d MMM yyyy').format(end)}';
}

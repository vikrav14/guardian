enum WellnessMetric { heartRate, bloodOxygen, bloodPressure, skinTemperature }

/// Display adapter for accepted evidence and explicitly authorized previews.
/// Skin temperature is restricted to the private pilot by its source adapter.
class WellnessSample {
  const WellnessSample({
    required this.metric,
    required this.value,
    required this.recordedAt,
    this.numericValue,
    this.secondaryValue,
  });
  final WellnessMetric metric;
  final String value;
  final DateTime recordedAt;

  /// Validated source values for charts. Never parse the formatted display text.
  /// Blood pressure keeps systolic and diastolic from the same source record.
  final num? numericValue, secondaryValue;

  bool get canPlot =>
      numericValue != null &&
      numericValue!.isFinite &&
      numericValue! > 0 &&
      (metric != WellnessMetric.bloodPressure ||
          (secondaryValue != null &&
              secondaryValue!.isFinite &&
              secondaryValue! > 0));
}

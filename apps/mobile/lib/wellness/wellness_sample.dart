enum WellnessMetric { heartRate, bloodOxygen, bloodPressure, skinTemperature }

/// Display adapter for accepted evidence and explicitly authorized previews.
/// Skin temperature is restricted to the private pilot by its source adapter.
class WellnessSample {
  const WellnessSample({
    required this.metric,
    required this.value,
    required this.recordedAt,
  });
  final WellnessMetric metric;
  final String value;
  final DateTime recordedAt;
}

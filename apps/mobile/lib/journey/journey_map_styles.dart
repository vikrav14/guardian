/// Google Maps styling for Journey.
///
/// Journey uses one calm, readable map presentation for every recorded day.
/// A route captured in the evening must not make an older date fall back to
/// the former dark map or a separate legacy layout.
class JourneyMapStyles {
  const JourneyMapStyles._();

  /// Keep Google's familiar light road map so place names remain readable.
  static const light = <Map<String, dynamic>>[];
}

/// Returns the single Journey map style for every point in a replay.
///
/// [replayTime] is intentionally accepted but does not affect presentation.
/// It documents that playback time is data, not a theme switch.
List<Map<String, dynamic>> journeyMapStyleForReplay(DateTime? replayTime) {
  return JourneyMapStyles.light;
}

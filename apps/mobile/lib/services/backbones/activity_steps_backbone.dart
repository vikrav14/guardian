class ActivityStepsBackbone {
  const ActivityStepsBackbone._();

  static const String serviceId = 'activity-steps';
  static const String displayName = 'Steps and daily activity';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'implementation_complete_disabled';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>['LK.stepsRaw', 'PEDO', 'WALKTIME'];
  static const List<String> safetyControls = <String>['wearer-controlled activity visibility', 'timezone-aware day boundaries', 'counter-reset detection', 'stale-packet rejection', 'no medical claims', 'fixed retention'];
  static const List<String> completedFrontendCapabilities = <String>['show accepted step cards', 'show last sync and data gaps', 'provide day and week views', 'explain estimates and non-medical status'];
  static const List<String> acceptanceGates = <String>['confirm raw counter semantics on exact V52 firmware', 'compare watch counters against controlled walks', 'test midnight timezone and reboot resets', 'measure battery and data impact'];
}

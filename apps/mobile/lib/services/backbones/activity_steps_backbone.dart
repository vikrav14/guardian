class ActivityStepsBackbone {
  const ActivityStepsBackbone._();

  static const String serviceId = 'activity-steps';
  static const String displayName = 'Steps and daily activity';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['PEDO', 'WALKTIME'];
  static const List<String> safetyControls = <String>['wearer-controlled activity visibility', 'timezone-aware day boundaries', 'counter-reset detection', 'no medical claims', 'bounded retention by plan'];
  static const List<String> frontendMilestones = <String>['show steps and active-time cards', 'show last sync and data gaps', 'provide day and week views', 'explain estimates and non-medical status'];
  static const List<String> acceptanceGates = <String>['confirm PEDO and WALKTIME payloads on exact V52 firmware', 'compare watch counters against controlled walks', 'test midnight timezone and reboot resets', 'measure battery and data impact'];
}

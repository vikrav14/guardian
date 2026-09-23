class WatchModesBackbone {
  const WatchModesBackbone._();

  static const String serviceId = 'watch-modes';
  static const String displayName = 'Answer and scene controls';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['profile', 'APPLOCK', 'ACALL'];
  static const List<String> safetyControls = <String>['explicit caregiver authorization', 'safe default ring mode', 'time-bounded silent mode', 'wearer-visible state', 'audit every remote change'];
  static const List<String> frontendMilestones = <String>['show current watch mode', 'offer firmware-supported choices only', 'confirm silent-mode changes', 'show sync and expiry state'];
  static const List<String> acceptanceGates = <String>['accept Calls app flow after pilot Auto/Manual pass', 'verify caller exclusivity and unknown-caller rejection', 'verify ring vibrate and silent results', 'prove safe recovery after reboot and timeout'];
}

class RemovalAlertsBackbone {
  const RemovalAlertsBackbone._();

  static const String serviceId = 'removal-alerts';
  static const String displayName = 'Watch-removal safety alerts';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'implementation_disabled';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const bool customerBuildEnabled = bool.fromEnvironment(
    'GUARDIAN_REMOVAL_ALERTS_ENABLED',
    defaultValue: false,
  );
  static const List<String> protocolCommands = <String>['REMOVESMS'];
  static const List<String> safetyControls = <String>['wearer-visible configuration', 'debounced removal events', 'configurable quiet periods', 'alert deduplication', 'privacy-safe event audit'];
  static const List<String> frontendMilestones = <String>['configure removal alerts', 'show removal and restored states', 'explain false-positive handling', 'show alert delivery history'];
  static const List<String> acceptanceGates = <String>['confirm REMOVESMS syntax on exact V52 firmware', 'measure wrist-off detection and restore timing', 'test sleep and charging false positives', 'verify only linked caregivers receive alerts'];
}

class SosContactsBackbone {
  const SosContactsBackbone._();

  static const String serviceId = 'sos-contacts';
  static const String displayName = 'Multi-contact SOS routing';
  static const String minimumPlan = 'essential';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['SOS1', 'SOS2', 'SOS3'];
  static const List<String> safetyControls = <String>['one verified primary guardian', 'explicit contact ordering', 'deduplicate phone numbers', 'failed-sync visibility', 'full contact-change audit'];
  static const List<String> frontendMilestones = <String>['edit and reorder SOS contacts', 'show primary and fallback roles', 'show device-sync state', 'link callback behaviour to PR #109'];
  static const List<String> acceptanceGates = <String>['confirm SOS1/SOS2/SOS3 support on exact V52 firmware', 'verify fallback order with controlled test numbers', 'verify coexistence with PR #109 callback alarm mode', 'confirm no unapproved number is written'];
}

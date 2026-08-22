class AdminControlsBackbone {
  const AdminControlsBackbone._();

  static const String serviceId = 'admin-controls';
  static const String displayName = 'Protected V52 device administration';
  static const String minimumPlan = 'operator';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>['VERNO', 'RESET', 'POWEROFF', 'FACTORY', 'gprsgps', 'LZ', 'UPGRADE', 'APN', 'IP', 'PW', 'ANY', 'CENTER', 'SLAVE'];
  static const List<String> safetyControls = <String>['operator role only', 'step-up authentication', 'typed confirmation for destructive commands', 'immutable audit and reason code', 'rate limits rollback and recovery runbook'];
  static const List<String> frontendMilestones = <String>['hide from customer navigation', 'provide operator capability and risk labels', 'require confirmation and reason', 'show command lifecycle and recovery guidance'];
  static const List<String> acceptanceGates = <String>['confirm each command against exact V52 firmware and vendor support', 'prove customer accounts cannot discover or invoke controls', 'exercise reset power-off and upgrade only on lab hardware', 'complete rollback incident and recovery drills'];
}

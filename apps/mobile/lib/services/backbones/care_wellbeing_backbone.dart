class CareWellbeingBackbone {
  const CareWellbeingBackbone._();

  static const String serviceId = 'care-wellbeing';
  static const String displayName = 'Care wellbeing readings';
  static const String minimumPlan = 'care';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['hrtstart', 'oxygen', 'bodytemp', 'bodytemp2', 'BTTIMESET'];
  static const List<String> safetyControls = <String>['wellness-only wording', 'no diagnosis or emergency clearance', 'explicit wearer consent', 'measurement quality and freshness labels', 'clinically unsafe values trigger human-check guidance'];
  static const List<String> frontendMilestones = <String>['request supported measurements', 'show quality freshness and device limitations', 'display trends with non-medical disclosure', 'direct concerning situations to appropriate human help'];
  static const List<String> acceptanceGates = <String>['confirm every command and upload shape on exact V52 firmware', 'compare repeated readings for consistency only', 'complete medical-language and privacy review', 'test missing stale implausible and failed measurements'];
}

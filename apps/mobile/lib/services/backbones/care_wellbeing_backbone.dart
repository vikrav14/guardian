class CareWellbeingBackbone {
  const CareWellbeingBackbone._();

  static const String serviceId = 'care-wellbeing';
  static const String displayName = 'Care wellbeing readings';
  static const String minimumPlan = 'care';
  static const String lifecycle = 'device_acceptance';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>['bphrt', 'oxygen', 'hrtstart'];
  static const List<String> acceptedUploads = <String>['bphrt', 'oxygen'];
  static const List<String> pilotOnlyRequests = <String>['hrtstart,1'];
  static const List<String> blockedUntilCaptured = <String>['bodytemp', 'bodytemp2', 'BTTIMESET'];
  static const List<String> safetyControls = <String>['non-medical wording', 'no diagnosis or emergency clearance', 'durable wearer consent', 'measurement quality and freshness labels', 'no automatic normal or abnormal classification'];
  static const List<String> frontendMilestones = <String>['show accepted wearer-initiated measurements', 'show quality freshness and device limitations', 'keep customer UI compile-disabled', 'direct concerns to a human or appropriate medical help'];
  static const List<String> acceptanceGates = <String>['confirm every command and upload shape on exact V52 firmware', 'compare repeated readings for consistency only', 'complete medical-language and privacy review', 'test missing stale implausible and failed measurements'];
}

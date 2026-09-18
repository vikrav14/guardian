class CareWellbeingBackbone {
  const CareWellbeingBackbone._();

  static const String serviceId = 'care-wellbeing';
  static const String displayName = 'Care wellbeing readings';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'customer_estimate';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['bphrt', 'oxygen', 'hrtstart', 'btemp2'];
  static const List<String> acceptedUploads = <String>['bphrt', 'oxygen', 'btemp2'];
  static const List<String> pilotOnlyUploads = <String>[];
  static const List<String> pilotOnlyRequests = <String>[];
  static const List<String> blockedUntilCaptured = <String>['BTTIMESET'];
  static const List<String> safetyControls = <String>['non-medical wording', 'no diagnosis or emergency clearance', 'durable wearer consent', 'measurement quality and freshness labels', 'no automatic normal or abnormal classification'];
  static const List<String> frontendMilestones = <String>['show watch estimates with quality and freshness', 'show device limitations and unconfirmed wearing', 'keep routines behind the Family or Care entitlement', 'direct concerns to a human or appropriate medical help'];
  static const List<String> acceptanceGates = <String>['confirm every command and upload shape on exact V52 firmware', 'compare repeated readings for consistency only', 'complete medical-language and privacy review', 'test missing stale implausible and failed measurements'];
}

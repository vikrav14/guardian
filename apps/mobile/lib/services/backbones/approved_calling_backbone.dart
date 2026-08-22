class ApprovedCallingBackbone {
  const ApprovedCallingBackbone._();

  static const String serviceId = 'approved-calling';
  static const String displayName = 'Approved family calling';
  static const String minimumPlan = 'essential';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['CALL', 'PHBX', 'DEVREFUSEPHONESWITCH'];
  static const List<String> safetyControls = <String>['approved-contact allowlist', 'authenticated guardian changes', 'arbitrary dialling disabled by default', 'call attempt audit trail', 'carrier voice-cost disclosure'];
  static const List<String> frontendMilestones = <String>['manage approved family contacts', 'show call-watch and allowed-call actions', 'explain carrier voice usage', 'show sync and failure states'];
  static const List<String> acceptanceGates = <String>['confirm exact V52 command forms on the target firmware', 'verify wearer-to-approved-contact and guardian-to-watch calls', 'verify unknown-number rejection behaviour', 'test two supported SIM/carrier configurations'];
}

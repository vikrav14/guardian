class AudioCheckinBackbone {
  const AudioCheckinBackbone._();

  static const String serviceId = 'audio-checkin';
  static const String displayName = 'Consent-based audio safety check-in';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['MONITOR'];
  static const List<String> safetyControls = <String>['explicit household consent', 'approved guardians only', 'no recording or transcription', 'one active request at a time', 'rate limits and immutable audit'];
  static const List<String> frontendMilestones = <String>['show consent and privacy disclosure', 'require positive confirmation', 'show request and failure states', 'provide revoke-access control'];
  static const List<String> acceptanceGates = <String>['confirm exact V52 MONITOR behaviour and carrier charging', 'verify access denial for non-guardians', 'verify audit and rate limits', 'complete privacy and legal review before activation'];
}

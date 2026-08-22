class VoiceMessagesBackbone {
  const VoiceMessagesBackbone._();

  static const String serviceId = 'voice-messages';
  static const String displayName = 'Family voice messages';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['TK', 'AMR'];
  static const List<String> safetyControls = <String>['approved caregivers only', 'bounded clip duration and size', 'malware-safe media handling', 'private expiring storage', 'data-usage disclosure'];
  static const List<String> frontendMilestones = <String>['record and send bounded voice clips', 'play received watch messages', 'show delivery and expiry state', 'show mobile-data disclosure'];
  static const List<String> acceptanceGates = <String>['confirm exact V52 uplink and downlink framing', 'validate codec and maximum payload on real hardware', 'measure data consumption', 'verify expired media cannot be fetched'];
}

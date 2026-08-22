class VoiceMessagesBackbone {
  const VoiceMessagesBackbone._();

  static const String serviceId = 'voice-messages';
  static const String displayName = 'SOS voice messages';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'development';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>['TK'];
  static const List<String> safetyControls = <String>['active SOS only', 'approved recipients only', 'bounded AMR clip duration and size', 'private expiring storage', 'recipient-bound WhatsApp playback', 'no remote microphone activation'];
  static const List<String> frontendMilestones = <String>['show clip availability on the SOS alert after acceptance', 'show delivery and expiry state', 'show mobile-data disclosure'];
  static const List<String> acceptanceGates = <String>['confirm exact V52 TK uplink framing', 'validate codec and maximum payload on real hardware', 'measure data consumption', 'approve guardian_sos_voice_ready_v1 template', 'verify expired media cannot be fetched'];
}

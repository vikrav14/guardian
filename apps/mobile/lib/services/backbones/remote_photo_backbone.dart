class RemotePhotoBackbone {
  const RemotePhotoBackbone._();

  static const String serviceId = 'remote-photo';
  static const String displayName = 'Secure safety photo requests';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['FTPIP', 'FTPPWD', 'PIC'];
  static const List<String> safetyControls = <String>['explicit household consent', 'approved guardians only', 'private isolated media ingress', 'short automatic expiry', 'request rate limits and immutable audit'];
  static const List<String> frontendMilestones = <String>['require safety-purpose confirmation', 'show request and upload progress', 'display access and expiry notice', 'support immediate photo deletion'];
  static const List<String> acceptanceGates = <String>['confirm FTPIP FTPPWD and PIC behaviour on exact V52 firmware', 'complete privacy and security review', 'verify upload isolation and expiry', 'measure image size latency and SIM data use'];
}

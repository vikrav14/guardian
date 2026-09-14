class WifiHomeBackbone {
  const WifiHomeBackbone._();

  static const String serviceId = 'wifi-home';
  static const String displayName = 'Wi-Fi home-presence detection';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = true;
  static const List<String> protocolCommands = <String>['WIFIFENCE'];
  static const List<String> safetyControls = <String>['store no Wi-Fi password', 'hash or minimize network identifiers', 'owner-controlled enrollment', 'location fallback when confidence is low', 'home-status access limited to linked caregivers'];
  static const List<String> frontendMilestones = <String>['guide 2.4 GHz home enrollment', 'show confidence and last update', 'explain location fallback', 'allow immediate network removal'];
  static const List<String> acceptanceGates = <String>['confirm WIFIFENCE syntax and event format on exact V52 firmware', 'verify identifier privacy at rest', 'test enter leave and router-restart cases', 'test phones with split and combined Wi-Fi SSIDs'];
}

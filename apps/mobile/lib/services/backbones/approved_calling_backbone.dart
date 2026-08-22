class ApprovedCallingBackbone {
  const ApprovedCallingBackbone._();

  static const String serviceId = 'approved-calling';
  static const String displayName = 'Approved family calling';
  static const String minimumPlan = 'essential';
  static const String lifecycle = 'backbone';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const String callDirection = 'approved-guardian-to-watch-only';
  static const List<String> protocolCommands = <String>['PHBX'];
  static const List<String> pendingProtocolCommands = <String>[
    'DEVREFUSEPHONESWITCH',
  ];
  static const List<String> safetyControls = <String>[
    'incoming approved-contact allowlist',
    'administrator-only phonebook provisioning',
    'unknown callers blocked',
    'wearer outbound calling unavailable',
    'carrier voice-cost disclosure',
  ];
  static const List<String> provenBehaviors = <String>[
    'approved phonebook number rings watch',
    'unknown number is blocked',
    'clear two-way audio after wearer answers',
    'phonebook entry persists after reboot',
  ];
  static const List<String> frontendMilestones = <String>[
    'manage approved family contacts',
    'show call-watch action only',
    'explain that the wearer cannot call out',
    'show sync and failure states',
  ];
  static const List<String> acceptanceGates = <String>[
    'repeat approved and unknown incoming-call checks on a second production watch',
    'confirm safe replacement or removal with ReachFar',
    'complete privacy, billing and contact-management acceptance',
  ];
}

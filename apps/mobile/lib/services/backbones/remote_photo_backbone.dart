class RemotePhotoBackbone {
  const RemotePhotoBackbone._();

  static const String serviceId = 'remote-photo';
  static const String displayName = 'Safety snapshot';
  static const String minimumPlan = 'family';
  static const String lifecycle = 'software_safety_path';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>[
    'FTPIP',
    'FTPPWD',
    'PIC',
    'rcapture',
  ];
  static const List<String> acceptedProtocolCommands = <String>[];
  static const List<String> safetyControls = <String>[
    'explicit household consent',
    'approved guardians only',
    'one-time authorization bound to one device and requester',
    'private isolated media ingress',
    'short automatic expiry and immediate deletion',
    'request cooldown and immutable audit',
    'no live camera and no continuous capture',
  ];
  static const List<String> frontendMilestones = <String>[
    'require safety-purpose confirmation',
    'show requested waiting available expired and deleted states',
    'display capture time and expiry notice',
    'support immediate deletion',
    'never imply a snapshot proves the wearer is safe',
  ];
  static const List<String> acceptanceGates = <String>[
    'confirm FTPIP FTPPWD PIC and rcapture roles on exact V52 firmware',
    'prove whether the wearer receives a visible or audible capture indication',
    'verify upload transport image type size latency and SIM data use',
    'verify private ingress expiry deletion and access logging',
    'repeat on a second production-equivalent V52',
    'complete privacy security and product acceptance',
  ];
}

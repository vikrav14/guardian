class CareRemindersBackbone {
  const CareRemindersBackbone._();

  static const String serviceId = 'care-reminders';
  static const String displayName =
      'Care routines and accessibility reminders';
  static const String minimumPlan = 'care';
  static const String lifecycle = 'implementation-disabled';
  static const bool enabledByDefault = false;
  static const bool customerVisible = false;
  static const List<String> protocolCommands = <String>[
    'SEDENTARY',
    'REMIND',
    'HSW',
  ];
  static const List<String> acceptedProtocolCommands = <String>[];
  static const List<String> safetyControls = <String>[
    'Care-plan entitlement',
    'wearer-visible schedules',
    'quiet hours and rate limits',
    'caregiver change audit',
    'no claim that reminders prove adherence',
    'no device command until exact-V52 acceptance',
  ];
  static const List<String> frontendMilestones = <String>[
    'hidden schedule presentation model',
    'show watch-sync state',
    'provide accessible clock options',
    'separate delivered from acknowledged',
  ];
  static const List<String> acceptanceGates = <String>[
    'confirm SEDENTARY REMIND and HSW syntax on exact V52 firmware',
    'verify display audio and vibration behaviour',
    'test overlapping reminders and reboots',
    'confirm the UI never invents acknowledgements',
  ];
}

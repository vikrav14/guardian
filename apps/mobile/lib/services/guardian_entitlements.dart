import 'package:cloud_firestore/cloud_firestore.dart';

enum GuardianPlan { essential, family, care }

enum GuardianSubscriptionViewState { checking, active, inactive, unavailable }

enum GuardianEntitlementDecisionState {
  allowed,
  checking,
  unavailable,
  inactive,
  upgradeRequired,
}

enum GuardianFeature {
  liveGps,
  sosAlerts,
  locationHistory,
  twoWayCalls,
  safeZones,
  batteryAlerts,
  familyCaregivers,
  guardianAi,
  whatsappQuestionsAnswers,
  whatsappSafetyAlerts,
  proactiveSmartNotifications,
  voiceAssistant,
  whatsappWatchCommands,
  medicationReminders,
  reminderAcknowledgements,
  wellbeingActivitySummaries,
  weeklyCareSummaries,
  shareableWellbeingReports,
  proactiveRoutineAlerts,
  prioritySupport,
}

extension GuardianPlanPresentation on GuardianPlan {
  String get wireValue => name;

  String get label => switch (this) {
    GuardianPlan.essential => 'Guardian Essential',
    GuardianPlan.family => 'Guardian Family',
    GuardianPlan.care => 'Guardian Care',
  };
}

extension GuardianFeaturePresentation on GuardianFeature {
  String get label => switch (this) {
    GuardianFeature.liveGps => 'Live GPS',
    GuardianFeature.sosAlerts => 'SOS alerts',
    GuardianFeature.locationHistory => 'Location history',
    GuardianFeature.twoWayCalls => 'Two-way calls',
    GuardianFeature.safeZones => 'Safe zones',
    GuardianFeature.batteryAlerts => 'Battery alerts',
    GuardianFeature.familyCaregivers => 'Family caregivers',
    GuardianFeature.guardianAi => 'Guardian AI',
    GuardianFeature.whatsappQuestionsAnswers =>
      'WhatsApp questions and answers',
    GuardianFeature.whatsappSafetyAlerts => 'WhatsApp safety alerts',
    GuardianFeature.proactiveSmartNotifications =>
      'Proactive smart notifications',
    GuardianFeature.voiceAssistant => 'Voice assistant',
    GuardianFeature.whatsappWatchCommands => 'WhatsApp watch commands',
    GuardianFeature.medicationReminders => 'Medication reminders',
    GuardianFeature.reminderAcknowledgements => 'Reminder acknowledgements',
    GuardianFeature.wellbeingActivitySummaries =>
      'Wellbeing and activity summaries',
    GuardianFeature.weeklyCareSummaries => 'Weekly care summaries',
    GuardianFeature.shareableWellbeingReports => 'Shareable wellbeing reports',
    GuardianFeature.proactiveRoutineAlerts => 'Proactive routine alerts',
    GuardianFeature.prioritySupport => 'Priority family support',
  };

  GuardianPlan get minimumPlan {
    if (_essentialFeatures.contains(this)) {
      return GuardianPlan.essential;
    }
    if (_familyFeatures.contains(this)) {
      return GuardianPlan.family;
    }
    return GuardianPlan.care;
  }
}

const _essentialFeatures = <GuardianFeature>{
  GuardianFeature.liveGps,
  GuardianFeature.sosAlerts,
  GuardianFeature.locationHistory,
  GuardianFeature.twoWayCalls,
  GuardianFeature.safeZones,
  GuardianFeature.batteryAlerts,
  GuardianFeature.familyCaregivers,
};

const _familyFeatures = <GuardianFeature>{
  ..._essentialFeatures,
  GuardianFeature.guardianAi,
  GuardianFeature.whatsappQuestionsAnswers,
  GuardianFeature.whatsappSafetyAlerts,
  GuardianFeature.proactiveSmartNotifications,
  GuardianFeature.voiceAssistant,
  GuardianFeature.whatsappWatchCommands,
};

const _careFeatures = <GuardianFeature>{
  ..._familyFeatures,
  GuardianFeature.medicationReminders,
  GuardianFeature.reminderAcknowledgements,
  GuardianFeature.wellbeingActivitySummaries,
  GuardianFeature.weeklyCareSummaries,
  GuardianFeature.shareableWellbeingReports,
  GuardianFeature.proactiveRoutineAlerts,
  GuardianFeature.prioritySupport,
};

/// Client presentation of the backend-owned service contract.
///
/// This class deliberately rejects legacy `users.subscription` maps. The only
/// supported input is a version-1 `serviceSubscriptions/{serviceOwnerUid}`
/// document written by a trusted backend manager.
class GuardianSubscription {
  const GuardianSubscription._({
    required this.serviceActive,
    required this.plan,
    required this.status,
    required this.reason,
    required this.ownerUid,
    required this.accessUntil,
    required this.features,
  });

  const GuardianSubscription.inactive({
    this.reason = 'missing_subscription',
    this.ownerUid,
  }) : serviceActive = false,
       plan = null,
       status = 'inactive',
       accessUntil = null,
       features = const <GuardianFeature>{};

  final bool serviceActive;
  final GuardianPlan? plan;
  final String status;
  final String? reason;
  final String? ownerUid;
  final DateTime? accessUntil;
  final Set<GuardianFeature> features;

  String get planLabel => plan?.label ?? 'Guardian service inactive';
  int get caregiverLimit => plan == GuardianPlan.essential
      ? 1
      : serviceActive
      ? 5
      : 0;
  int? get locationHistoryDays => plan == GuardianPlan.essential
      ? 7
      : serviceActive
      ? null
      : 0;

  bool has(GuardianFeature feature) =>
      serviceActive && features.contains(feature);

  bool canAccessHistoryDay(DateTime day, {DateTime? now}) {
    if (!has(GuardianFeature.locationHistory)) {
      return false;
    }
    final days = locationHistoryDays;
    if (days == null) {
      return true;
    }
    final clock = now ?? DateTime.now();
    final today = DateTime(clock.year, clock.month, clock.day);
    final requestedDay = DateTime(day.year, day.month, day.day);
    final firstDay = today.subtract(Duration(days: days - 1));
    return !requestedDay.isBefore(firstDay) && !requestedDay.isAfter(today);
  }

  DateTime historyBoundary({DateTime? now}) {
    final clock = now ?? DateTime.now();
    final days = locationHistoryDays;
    return days == null
        ? DateTime.fromMillisecondsSinceEpoch(0)
        : clock.subtract(Duration(days: days));
  }

  DateTime historyFirstSelectableDay({DateTime? now}) {
    final clock = now ?? DateTime.now();
    final today = DateTime(clock.year, clock.month, clock.day);
    if (!serviceActive || !has(GuardianFeature.locationHistory)) {
      return today;
    }
    if (locationHistoryDays == null) {
      return DateTime(2000, 1, 1);
    }
    return today.subtract(Duration(days: locationHistoryDays! - 1));
  }

  factory GuardianSubscription.fromMap(
    Map<String, dynamic>? map, {
    String? ownerUid,
    DateTime? now,
  }) {
    if (map == null) {
      return GuardianSubscription.inactive(ownerUid: ownerUid);
    }

    final version = map['version'];
    final managedBy = (map['managedBy'] as String?)?.trim().toLowerCase();
    if (version != 1 ||
        !const {'guardian_admin', 'billing', 'migration'}.contains(managedBy)) {
      return GuardianSubscription.inactive(
        reason: 'untrusted_legacy_subscription',
        ownerUid: ownerUid,
      );
    }

    final plan = switch ((map['plan'] as String?)?.trim().toLowerCase()) {
      'essential' => GuardianPlan.essential,
      'family' => GuardianPlan.family,
      'care' => GuardianPlan.care,
      _ => null,
    };
    if (plan == null) {
      return GuardianSubscription.inactive(
        reason: 'unknown_plan',
        ownerUid: ownerUid,
      );
    }

    final status = (map['status'] as String?)?.trim().toLowerCase() ?? '';
    final clock = now ?? DateTime.now();
    final currentPeriodEnd = _asDate(map['currentPeriodEnd']);
    final trialEndsAt = _asDate(map['trialEndsAt']);
    final graceEndsAt = _asDate(map['graceEndsAt']);
    DateTime? accessUntil = currentPeriodEnd;
    final active = switch (status) {
      'active' => currentPeriodEnd == null || currentPeriodEnd.isAfter(clock),
      'trialing' => trialEndsAt?.isAfter(clock) == true,
      'grace_period' || 'past_due' => graceEndsAt?.isAfter(clock) == true,
      'cancelled' => currentPeriodEnd?.isAfter(clock) == true,
      _ => false,
    };
    if (status == 'trialing') {
      accessUntil = trialEndsAt;
    }
    if (status == 'grace_period' || status == 'past_due') {
      accessUntil = graceEndsAt;
    }
    if (!active) {
      return GuardianSubscription.inactive(
        reason: status.isEmpty
            ? 'inactive_subscription_status'
            : 'subscription_access_ended',
        ownerUid: ownerUid,
      );
    }

    final features = switch (plan) {
      GuardianPlan.essential => _essentialFeatures,
      GuardianPlan.family => _familyFeatures,
      GuardianPlan.care => _careFeatures,
    };
    return GuardianSubscription._(
      serviceActive: true,
      plan: plan,
      status: status,
      reason: null,
      ownerUid: ownerUid,
      accessUntil: accessUntil,
      features: features,
    );
  }
}

class GuardianEntitlementDecision {
  const GuardianEntitlementDecision._({
    required this.state,
    required this.feature,
    required this.allowed,
    required this.title,
    required this.message,
    required this.minimumPlan,
  });

  final GuardianEntitlementDecisionState state;
  final GuardianFeature feature;
  final bool allowed;
  final String title;
  final String message;
  final GuardianPlan minimumPlan;

  factory GuardianEntitlementDecision.resolve({
    required GuardianFeature feature,
    GuardianSubscription? subscription,
    bool checking = false,
    Object? error,
  }) {
    final minimumPlan = feature.minimumPlan;
    if (error != null) {
      return GuardianEntitlementDecision._(
        state: GuardianEntitlementDecisionState.unavailable,
        feature: feature,
        allowed: false,
        title: 'Could not verify your plan',
        message:
            'Guardian could not verify this family\'s service plan. ${feature.label} remains unavailable until verification succeeds.',
        minimumPlan: minimumPlan,
      );
    }
    if (subscription == null && checking) {
      return GuardianEntitlementDecision._(
        state: GuardianEntitlementDecisionState.checking,
        feature: feature,
        allowed: false,
        title: 'Checking your plan',
        message: 'Guardian is verifying access to ${feature.label}.',
        minimumPlan: minimumPlan,
      );
    }

    final sub = subscription ?? const GuardianSubscription.inactive();
    if (!sub.serviceActive) {
      return GuardianEntitlementDecision._(
        state: GuardianEntitlementDecisionState.inactive,
        feature: feature,
        allowed: false,
        title: 'Guardian service inactive',
        message:
            '${feature.label} is unavailable because Guardian service is not active for this family.',
        minimumPlan: minimumPlan,
      );
    }
    if (sub.has(feature)) {
      return GuardianEntitlementDecision._(
        state: GuardianEntitlementDecisionState.allowed,
        feature: feature,
        allowed: true,
        title: feature.label,
        message: '${feature.label} is included with ${sub.planLabel}.',
        minimumPlan: minimumPlan,
      );
    }

    final requiredLabel = minimumPlan == GuardianPlan.family
        ? 'Guardian Family or Guardian Care'
        : minimumPlan.label;
    return GuardianEntitlementDecision._(
      state: GuardianEntitlementDecisionState.upgradeRequired,
      feature: feature,
      allowed: false,
      title: '${feature.label} is not included',
      message:
          '${feature.label} requires $requiredLabel. This family is currently on ${sub.planLabel}.',
      minimumPlan: minimumPlan,
    );
  }
}

/// Turns subscription stream state into honest, deterministic account copy.
///
/// A Firestore permission or network error must never be presented as an
/// inactive subscription. Restricted features still fail closed, but the user
/// is told that Guardian could not verify the plan rather than being told the
/// plan does not exist.
class GuardianSubscriptionPresentation {
  const GuardianSubscriptionPresentation._({
    required this.state,
    required this.trailingLabel,
    required this.message,
  });

  final GuardianSubscriptionViewState state;
  final String trailingLabel;
  final String message;

  factory GuardianSubscriptionPresentation.resolve({
    GuardianSubscription? subscription,
    bool checking = false,
    Object? error,
  }) {
    if (error != null) {
      return const GuardianSubscriptionPresentation._(
        state: GuardianSubscriptionViewState.unavailable,
        trailingLabel: 'Could not verify',
        message:
            'Guardian could not verify this family\'s service plan. Check the connection or contact Guardian support. Restricted services remain unavailable until verification succeeds.',
      );
    }

    if (subscription == null && checking) {
      return const GuardianSubscriptionPresentation._(
        state: GuardianSubscriptionViewState.checking,
        trailingLabel: 'Checking…',
        message: 'Guardian is checking this family\'s service plan.',
      );
    }

    final sub = subscription ?? const GuardianSubscription.inactive();
    if (sub.serviceActive) {
      return GuardianSubscriptionPresentation._(
        state: GuardianSubscriptionViewState.active,
        trailingLabel: sub.planLabel,
        message:
            'Your family is on ${sub.planLabel}. Services and limits adapt to this plan.',
      );
    }

    return const GuardianSubscriptionPresentation._(
      state: GuardianSubscriptionViewState.inactive,
      trailingLabel: 'Guardian service inactive',
      message:
          'Guardian service is not active for this family account. Contact Guardian support to review the subscription.',
    );
  }
}

DateTime? _asDate(Object? value) {
  if (value is Timestamp) {
    return value.toDate();
  }
  if (value is DateTime) {
    return value;
  }
  if (value is String) {
    return DateTime.tryParse(value);
  }
  return null;
}

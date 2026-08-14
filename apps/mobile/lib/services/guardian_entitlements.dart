import 'package:cloud_firestore/cloud_firestore.dart';

enum GuardianPlan { essential, family, care }

enum GuardianSubscriptionViewState { checking, active, inactive, unavailable }

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
  int get caregiverLimit => plan == GuardianPlan.essential ? 1 : serviceActive ? 5 : 0;
  int? get locationHistoryDays => plan == GuardianPlan.essential ? 7 : serviceActive ? null : 0;

  bool has(GuardianFeature feature) => serviceActive && features.contains(feature);

  bool canAccessHistoryDay(DateTime day, {DateTime? now}) {
    if (!has(GuardianFeature.locationHistory)) return false;
    final days = locationHistoryDays;
    if (days == null) return true;
    final clock = now ?? DateTime.now();
    final endOfDay = DateTime(day.year, day.month, day.day).add(const Duration(days: 1));
    return endOfDay.isAfter(clock.subtract(Duration(days: days)));
  }

  DateTime historyBoundary({DateTime? now}) {
    final clock = now ?? DateTime.now();
    final days = locationHistoryDays;
    return days == null ? DateTime.fromMillisecondsSinceEpoch(0) : clock.subtract(Duration(days: days));
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
    if (version != 1 || !const {'guardian_admin', 'billing', 'migration'}.contains(managedBy)) {
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
      return GuardianSubscription.inactive(reason: 'unknown_plan', ownerUid: ownerUid);
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
    if (status == 'trialing') accessUntil = trialEndsAt;
    if (status == 'grace_period' || status == 'past_due') accessUntil = graceEndsAt;
    if (!active) {
      return GuardianSubscription.inactive(
        reason: status.isEmpty ? 'inactive_subscription_status' : 'subscription_access_ended',
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
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

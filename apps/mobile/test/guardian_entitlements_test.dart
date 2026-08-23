import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';

void main() {
  final now = DateTime.utc(2026, 8, 14);

  Map<String, dynamic> subscription(
    String plan, {
    String status = 'active',
    Map<String, dynamic> extra = const {},
  }) => {
    'version': 1,
    'managedBy': 'guardian_admin',
    'plan': plan,
    'status': status,
    ...extra,
  };

  test('legacy display subscription fails closed', () {
    final result = GuardianSubscription.fromMap({
      'tier': 'premium',
      'status': 'active',
    }, now: now);

    expect(result.serviceActive, false);
    expect(result.reason, 'untrusted_legacy_subscription');
  });

  test('Essential has core services, one caregiver and seven days', () {
    final result = GuardianSubscription.fromMap(
      subscription('essential'),
      now: now,
    );

    expect(result.serviceActive, true);
    expect(result.has(GuardianFeature.liveGps), true);
    expect(result.has(GuardianFeature.whatsappQuestionsAnswers), false);
    expect(result.caregiverLimit, 1);
    expect(result.locationHistoryDays, 7);
  });

  test('Family adds WhatsApp but not Care medication services', () {
    final result = GuardianSubscription.fromMap(
      subscription('family'),
      now: now,
    );

    expect(result.has(GuardianFeature.whatsappQuestionsAnswers), true);
    expect(result.has(GuardianFeature.watchRemovalAlerts), true);
    expect(result.has(GuardianFeature.medicationReminders), false);
    expect(result.caregiverLimit, 5);
    expect(result.locationHistoryDays, isNull);
  });

  test('Care inherits all services', () {
    final result = GuardianSubscription.fromMap(subscription('care'), now: now);

    expect(result.has(GuardianFeature.liveGps), true);
    expect(result.has(GuardianFeature.whatsappQuestionsAnswers), true);
    expect(result.has(GuardianFeature.medicationReminders), true);
    expect(result.has(GuardianFeature.weeklyCareSummaries), true);
  });

  test('bounded statuses expire deterministically', () {
    final future = Timestamp.fromDate(now.add(const Duration(days: 1)));
    final past = Timestamp.fromDate(now.subtract(const Duration(days: 1)));

    expect(
      GuardianSubscription.fromMap(
        subscription(
          'family',
          status: 'trialing',
          extra: {'trialEndsAt': future},
        ),
        now: now,
      ).serviceActive,
      true,
    );
    expect(
      GuardianSubscription.fromMap(
        subscription(
          'family',
          status: 'trialing',
          extra: {'trialEndsAt': past},
        ),
        now: now,
      ).serviceActive,
      false,
    );
  });

  test('Essential history boundary is rolling and Family is unrestricted', () {
    final essential = GuardianSubscription.fromMap(
      subscription('essential'),
      now: now,
    );
    final family = GuardianSubscription.fromMap(
      subscription('family'),
      now: now,
    );

    expect(
      essential.canAccessHistoryDay(
        now.subtract(const Duration(days: 3)),
        now: now,
      ),
      true,
    );
    expect(
      essential.canAccessHistoryDay(
        now.subtract(const Duration(days: 9)),
        now: now,
      ),
      false,
    );
    expect(family.canAccessHistoryDay(DateTime.utc(2020), now: now), true);
    expect(essential.historyFirstSelectableDay(now: now), DateTime(2026, 8, 8));
    expect(family.historyFirstSelectableDay(now: now), DateTime(2000, 1, 1));
  });

  test('feature decisions provide deterministic plan-aware locked copy', () {
    final essential = GuardianSubscription.fromMap(
      subscription('essential'),
      now: now,
    );
    final family = GuardianSubscription.fromMap(
      subscription('family'),
      now: now,
    );

    final whatsapp = GuardianEntitlementDecision.resolve(
      feature: GuardianFeature.whatsappQuestionsAnswers,
      subscription: essential,
    );
    final medication = GuardianEntitlementDecision.resolve(
      feature: GuardianFeature.medicationReminders,
      subscription: family,
    );

    expect(whatsapp.allowed, false);
    expect(whatsapp.state, GuardianEntitlementDecisionState.upgradeRequired);
    expect(whatsapp.message, contains('Guardian Family or Guardian Care'));
    expect(medication.allowed, false);
    expect(medication.minimumPlan, GuardianPlan.care);
    expect(medication.message, contains('Guardian Care'));
  });

  test('feature decisions fail closed while checking or unavailable', () {
    final checking = GuardianEntitlementDecision.resolve(
      feature: GuardianFeature.guardianAi,
      checking: true,
    );
    final unavailable = GuardianEntitlementDecision.resolve(
      feature: GuardianFeature.guardianAi,
      error: StateError('offline'),
    );

    expect(checking.allowed, false);
    expect(checking.state, GuardianEntitlementDecisionState.checking);
    expect(unavailable.allowed, false);
    expect(unavailable.state, GuardianEntitlementDecisionState.unavailable);
  });

  test(
    'subscription presentation distinguishes loading, inactive and errors',
    () {
      final checking = GuardianSubscriptionPresentation.resolve(checking: true);
      final inactive = GuardianSubscriptionPresentation.resolve(
        subscription: const GuardianSubscription.inactive(),
      );
      final unavailable = GuardianSubscriptionPresentation.resolve(
        error: StateError('permission-denied'),
      );

      expect(checking.state, GuardianSubscriptionViewState.checking);
      expect(checking.trailingLabel, 'Checking…');
      expect(inactive.state, GuardianSubscriptionViewState.inactive);
      expect(inactive.trailingLabel, 'Guardian service inactive');
      expect(unavailable.state, GuardianSubscriptionViewState.unavailable);
      expect(unavailable.trailingLabel, 'Could not verify');
      expect(
        unavailable.message,
        contains('Restricted services remain unavailable'),
      );
    },
  );

  test('active subscription presentation names the verified plan', () {
    final care = GuardianSubscription.fromMap(subscription('care'), now: now);
    final presentation = GuardianSubscriptionPresentation.resolve(
      subscription: care,
    );

    expect(presentation.state, GuardianSubscriptionViewState.active);
    expect(presentation.trailingLabel, 'Guardian Care');
    expect(presentation.message, contains('Services and limits adapt'));
  });
}

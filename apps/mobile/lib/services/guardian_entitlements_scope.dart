import 'package:flutter/widgets.dart';

import 'guardian_entitlements.dart';

class GuardianEntitlementsScope extends InheritedWidget {
  const GuardianEntitlementsScope({
    super.key,
    required this.subscription,
    required this.checking,
    this.error,
    required super.child,
  });

  final GuardianSubscription? subscription;
  final bool checking;
  final Object? error;

  GuardianEntitlementDecision decision(GuardianFeature feature) {
    return GuardianEntitlementDecision.resolve(
      feature: feature,
      subscription: subscription,
      checking: checking,
      error: error,
    );
  }

  static GuardianEntitlementsScope? maybeOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<GuardianEntitlementsScope>();
  }

  static GuardianEntitlementsScope of(BuildContext context) {
    final scope = maybeOf(context);
    assert(scope != null, 'No GuardianEntitlementsScope found in context.');
    return scope!;
  }

  @override
  bool updateShouldNotify(GuardianEntitlementsScope oldWidget) {
    return subscription != oldWidget.subscription ||
        checking != oldWidget.checking ||
        error != oldWidget.error;
  }
}

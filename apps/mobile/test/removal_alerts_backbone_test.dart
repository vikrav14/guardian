import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/removal_alerts_backbone.dart';

void main() {
  test('removal-alerts stays hidden until its acceptance gates pass', () {
    expect(RemovalAlertsBackbone.lifecycle, 'implementation_disabled');
    expect(RemovalAlertsBackbone.enabledByDefault, isFalse);
    expect(RemovalAlertsBackbone.minimumPlan, 'family');
    expect(RemovalAlertsBackbone.customerVisible, isFalse);
    expect(RemovalAlertsBackbone.customerBuildEnabled, isFalse);
    expect(RemovalAlertsBackbone.protocolCommands, isNotEmpty);
    expect(RemovalAlertsBackbone.frontendMilestones, isNotEmpty);
    expect(RemovalAlertsBackbone.acceptanceGates, isNotEmpty);
  });
}

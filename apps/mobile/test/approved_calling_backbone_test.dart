import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/approved_calling_backbone.dart';
import 'package:guardian/services/guardian_entitlements.dart';

void main() {
  test('approved-calling stays hidden until its acceptance gates pass', () {
    expect(ApprovedCallingBackbone.lifecycle, 'backbone');
    expect(ApprovedCallingBackbone.enabledByDefault, isFalse);
    expect(ApprovedCallingBackbone.customerVisible, isFalse);
    expect(ApprovedCallingBackbone.minimumPlan, 'essential');
    expect(
      ApprovedCallingBackbone.callDirection,
      'approved-guardian-to-watch-only',
    );
    expect(ApprovedCallingBackbone.protocolCommands, <String>['PHBX']);
    expect(ApprovedCallingBackbone.protocolCommands, isNot(contains('CALL')));
    expect(
      ApprovedCallingBackbone.provenBehaviors,
      contains('unknown number is blocked'),
    );
    expect(ApprovedCallingBackbone.frontendMilestones, isNotEmpty);
    expect(ApprovedCallingBackbone.acceptanceGates, isNotEmpty);
    expect(
      GuardianFeature.twoWayCalls.label,
      'Family can call the watch',
    );
  });
}

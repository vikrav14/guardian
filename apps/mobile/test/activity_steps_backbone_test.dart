import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/activity_steps_backbone.dart';

void main() {
  test('activity-steps stays hidden until its acceptance gates pass', () {
    expect(
      ActivityStepsBackbone.lifecycle,
      'implementation_complete_disabled',
    );
    expect(ActivityStepsBackbone.enabledByDefault, isFalse);
    expect(ActivityStepsBackbone.customerVisible, isFalse);
    expect(ActivityStepsBackbone.minimumPlan, 'family');
    expect(ActivityStepsBackbone.protocolCommands, isNotEmpty);
    expect(ActivityStepsBackbone.completedFrontendCapabilities, isNotEmpty);
    expect(ActivityStepsBackbone.acceptanceGates, isNotEmpty);
  });
}

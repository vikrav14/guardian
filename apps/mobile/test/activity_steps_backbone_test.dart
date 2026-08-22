import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/activity_steps_backbone.dart';

void main() {
  test('activity-steps stays hidden until its acceptance gates pass', () {
    expect(ActivityStepsBackbone.lifecycle, 'backbone');
    expect(ActivityStepsBackbone.enabledByDefault, isFalse);
    expect(ActivityStepsBackbone.minimumPlan, 'family');
    expect(ActivityStepsBackbone.protocolCommands, isNotEmpty);
    expect(ActivityStepsBackbone.frontendMilestones, isNotEmpty);
    expect(ActivityStepsBackbone.acceptanceGates, isNotEmpty);
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/care_reminders_backbone.dart';

void main() {
  test('care-reminders stays hidden until its acceptance gates pass', () {
    expect(CareRemindersBackbone.lifecycle, 'backbone');
    expect(CareRemindersBackbone.enabledByDefault, isFalse);
    expect(CareRemindersBackbone.minimumPlan, 'care');
    expect(CareRemindersBackbone.protocolCommands, isNotEmpty);
    expect(CareRemindersBackbone.frontendMilestones, isNotEmpty);
    expect(CareRemindersBackbone.acceptanceGates, isNotEmpty);
  });
}

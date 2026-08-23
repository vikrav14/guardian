import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/care_reminders_backbone.dart';

void main() {
  test('care-reminders stays hidden until its acceptance gates pass', () {
    expect(CareRemindersBackbone.lifecycle, 'implementation-disabled');
    expect(CareRemindersBackbone.enabledByDefault, isFalse);
    expect(CareRemindersBackbone.customerVisible, isFalse);
    expect(CareRemindersBackbone.minimumPlan, 'care');
    expect(CareRemindersBackbone.protocolCommands, isNotEmpty);
    expect(CareRemindersBackbone.acceptedProtocolCommands, isEmpty);
    expect(CareRemindersBackbone.frontendMilestones, isNotEmpty);
    expect(CareRemindersBackbone.acceptanceGates, isNotEmpty);
  });
}

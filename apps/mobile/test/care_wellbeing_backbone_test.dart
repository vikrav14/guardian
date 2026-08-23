import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/care_wellbeing_backbone.dart';

void main() {
  test('care-wellbeing stays hidden until its acceptance gates pass', () {
    expect(CareWellbeingBackbone.lifecycle, 'device_acceptance');
    expect(CareWellbeingBackbone.enabledByDefault, isFalse);
    expect(CareWellbeingBackbone.customerVisible, isFalse);
    expect(CareWellbeingBackbone.minimumPlan, 'care');
    expect(CareWellbeingBackbone.protocolCommands, isNotEmpty);
    expect(CareWellbeingBackbone.acceptedUploads, <String>['bphrt', 'oxygen']);
    expect(CareWellbeingBackbone.blockedUntilCaptured, isNotEmpty);
    expect(CareWellbeingBackbone.frontendMilestones, isNotEmpty);
    expect(CareWellbeingBackbone.acceptanceGates, isNotEmpty);
  });
}

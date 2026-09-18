import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/care_wellbeing_backbone.dart';

void main() {
  test('care-wellbeing exposes guarded customer estimates by default', () {
    expect(CareWellbeingBackbone.lifecycle, 'customer_estimate');
    expect(CareWellbeingBackbone.enabledByDefault, isFalse);
    expect(CareWellbeingBackbone.customerVisible, isTrue);
    expect(CareWellbeingBackbone.minimumPlan, 'family');
    expect(CareWellbeingBackbone.protocolCommands, isNotEmpty);
    expect(CareWellbeingBackbone.acceptedUploads, <String>[
      'bphrt',
      'oxygen',
      'btemp2',
    ]);
    expect(CareWellbeingBackbone.pilotOnlyUploads, isEmpty);
    expect(CareWellbeingBackbone.pilotOnlyRequests, isEmpty);
    expect(CareWellbeingBackbone.blockedUntilCaptured, isNotEmpty);
    expect(CareWellbeingBackbone.frontendMilestones, isNotEmpty);
    expect(CareWellbeingBackbone.acceptanceGates, isNotEmpty);
  });
}

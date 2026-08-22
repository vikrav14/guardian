import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/approved_calling_backbone.dart';

void main() {
  test('approved-calling stays hidden until its acceptance gates pass', () {
    expect(ApprovedCallingBackbone.lifecycle, 'backbone');
    expect(ApprovedCallingBackbone.enabledByDefault, isFalse);
    expect(ApprovedCallingBackbone.minimumPlan, 'essential');
    expect(ApprovedCallingBackbone.protocolCommands, isNotEmpty);
    expect(ApprovedCallingBackbone.frontendMilestones, isNotEmpty);
    expect(ApprovedCallingBackbone.acceptanceGates, isNotEmpty);
  });
}

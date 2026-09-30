import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/sos_contacts_backbone.dart';

void main() {
  test('sos-contacts stays hidden until its acceptance gates pass', () {
    expect(SosContactsBackbone.lifecycle, 'backbone');
    expect(SosContactsBackbone.enabledByDefault, isFalse);
    expect(SosContactsBackbone.minimumPlan, 'essential');
    expect(SosContactsBackbone.protocolCommands, isNotEmpty);
    expect(SosContactsBackbone.frontendMilestones, isNotEmpty);
    expect(SosContactsBackbone.acceptanceGates, isNotEmpty);
  });
}

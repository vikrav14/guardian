import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/admin_controls_backbone.dart';

void main() {
  test('admin-controls stays hidden until its acceptance gates pass', () {
    expect(AdminControlsBackbone.lifecycle, 'backbone');
    expect(AdminControlsBackbone.enabledByDefault, isFalse);
    expect(AdminControlsBackbone.minimumPlan, 'operator');
    expect(AdminControlsBackbone.protocolCommands, isNotEmpty);
    expect(AdminControlsBackbone.frontendMilestones, isNotEmpty);
    expect(AdminControlsBackbone.acceptanceGates, isNotEmpty);
  });
}

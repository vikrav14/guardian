import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/wifi_home_backbone.dart';

void main() {
  test('wifi-home stays hidden until its acceptance gates pass', () {
    expect(WifiHomeBackbone.lifecycle, 'backbone');
    expect(WifiHomeBackbone.enabledByDefault, isFalse);
    expect(WifiHomeBackbone.minimumPlan, 'family');
    expect(WifiHomeBackbone.protocolCommands, isNotEmpty);
    expect(WifiHomeBackbone.frontendMilestones, isNotEmpty);
    expect(WifiHomeBackbone.acceptanceGates, isNotEmpty);
  });
}

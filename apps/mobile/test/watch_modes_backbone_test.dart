import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/watch_modes_backbone.dart';

void main() {
  test('watch-modes stays hidden until its acceptance gates pass', () {
    expect(WatchModesBackbone.lifecycle, 'backbone');
    expect(WatchModesBackbone.enabledByDefault, isFalse);
    expect(WatchModesBackbone.minimumPlan, 'family');
    expect(WatchModesBackbone.protocolCommands, isNotEmpty);
    expect(WatchModesBackbone.frontendMilestones, isNotEmpty);
    expect(WatchModesBackbone.acceptanceGates, isNotEmpty);
  });
}

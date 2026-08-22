import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/audio_checkin_backbone.dart';

void main() {
  test('audio-checkin stays hidden until its acceptance gates pass', () {
    expect(AudioCheckinBackbone.lifecycle, 'backbone');
    expect(AudioCheckinBackbone.enabledByDefault, isFalse);
    expect(AudioCheckinBackbone.minimumPlan, 'family');
    expect(AudioCheckinBackbone.protocolCommands, isNotEmpty);
    expect(AudioCheckinBackbone.frontendMilestones, isNotEmpty);
    expect(AudioCheckinBackbone.acceptanceGates, isNotEmpty);
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/voice_messages_backbone.dart';

void main() {
  test('voice-messages stays hidden until its acceptance gates pass', () {
    expect(VoiceMessagesBackbone.lifecycle, 'backbone');
    expect(VoiceMessagesBackbone.enabledByDefault, isFalse);
    expect(VoiceMessagesBackbone.minimumPlan, 'family');
    expect(VoiceMessagesBackbone.protocolCommands, isNotEmpty);
    expect(VoiceMessagesBackbone.frontendMilestones, isNotEmpty);
    expect(VoiceMessagesBackbone.acceptanceGates, isNotEmpty);
  });
}

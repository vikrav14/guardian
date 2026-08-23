import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/voice_messages_backbone.dart';

void main() {
  test('SOS voice messages stay hidden until hardware and template acceptance', () {
    expect(VoiceMessagesBackbone.lifecycle, 'development');
    expect(VoiceMessagesBackbone.enabledByDefault, isFalse);
    expect(VoiceMessagesBackbone.customerVisible, isFalse);
    expect(VoiceMessagesBackbone.minimumPlan, 'family');
    expect(VoiceMessagesBackbone.protocolCommands, <String>['TK']);
    expect(VoiceMessagesBackbone.safetyControls, contains('active SOS only'));
    expect(
      VoiceMessagesBackbone.safetyControls,
      contains('no remote microphone activation'),
    );
    expect(VoiceMessagesBackbone.frontendMilestones, isNotEmpty);
    expect(VoiceMessagesBackbone.acceptanceGates, isNotEmpty);
  });
}

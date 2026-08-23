import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/audio_checkin_backbone.dart';

void main() {
  test('audio-checkin stays hidden until its acceptance gates pass', () {
    expect(AudioCheckinBackbone.lifecycle, 'backbone');
    expect(AudioCheckinBackbone.enabledByDefault, isFalse);
    expect(AudioCheckinBackbone.customerVisible, isFalse);
    expect(AudioCheckinBackbone.canRenderCustomerEntryPoint, isFalse);
    expect(AudioCheckinBackbone.minimumPlan, 'family');
    expect(AudioCheckinBackbone.protocolCommands, isNotEmpty);
    expect(
      AudioCheckinBackbone.documentedProtocolVariants,
      containsAll(<String>['MONITOR', 'MONITOR,<verified callback>']),
    );
    expect(
      AudioCheckinBackbone.protocolEvidence,
      'vendor-conflict-unproven',
    );
    expect(AudioCheckinBackbone.frontendMilestones, isNotEmpty);
    expect(AudioCheckinBackbone.acceptanceGates, isNotEmpty);
  });

  test('legacy direct MONITOR controls are absent from the customer app', () {
    final commandService = File(
      'lib/services/guardian_services.dart',
    ).readAsStringSync();
    final accountPage = File('lib/screens/account_page.dart').readAsStringSync();

    expect(commandService, isNot(contains('startVoiceMonitor')));
    expect(commandService, isNot(contains("'voice_monitor'")));
    expect(accountPage, isNot(contains("Text('Listen in')")));
    expect(accountPage, isNot(contains('receive the silent call')));
  });
}

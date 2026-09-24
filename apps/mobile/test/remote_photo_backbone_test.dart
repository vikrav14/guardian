import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/remote_photo_backbone.dart';

void main() {
  test('Safety snapshot has an observed command but remains default-off', () {
    expect(RemotePhotoBackbone.lifecycle, 'controlled_app_integration');
    expect(RemotePhotoBackbone.enabledByDefault, isFalse);
    expect(RemotePhotoBackbone.customerVisible, isFalse);
    expect(RemotePhotoBackbone.minimumPlan, 'family');
    expect(RemotePhotoBackbone.protocolCommands, contains('PIC'));
    expect(RemotePhotoBackbone.protocolCommands, contains('rcapture'));
    expect(RemotePhotoBackbone.acceptedProtocolCommands, ['rcapture']);
    expect(RemotePhotoBackbone.frontendMilestones, isNotEmpty);
    expect(RemotePhotoBackbone.acceptanceGates, isNotEmpty);
  });
}

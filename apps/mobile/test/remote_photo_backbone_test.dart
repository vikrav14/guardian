import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/remote_photo_backbone.dart';

void main() {
  test('Safety snapshot stays hidden and non-dispatchable', () {
    expect(RemotePhotoBackbone.lifecycle, 'software_safety_path');
    expect(RemotePhotoBackbone.enabledByDefault, isFalse);
    expect(RemotePhotoBackbone.customerVisible, isFalse);
    expect(RemotePhotoBackbone.minimumPlan, 'family');
    expect(RemotePhotoBackbone.protocolCommands, contains('PIC'));
    expect(RemotePhotoBackbone.protocolCommands, contains('rcapture'));
    expect(RemotePhotoBackbone.acceptedProtocolCommands, isEmpty);
    expect(RemotePhotoBackbone.frontendMilestones, isNotEmpty);
    expect(RemotePhotoBackbone.acceptanceGates, isNotEmpty);
  });
}

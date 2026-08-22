import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/backbones/remote_photo_backbone.dart';

void main() {
  test('remote-photo stays hidden until its acceptance gates pass', () {
    expect(RemotePhotoBackbone.lifecycle, 'backbone');
    expect(RemotePhotoBackbone.enabledByDefault, isFalse);
    expect(RemotePhotoBackbone.minimumPlan, 'family');
    expect(RemotePhotoBackbone.protocolCommands, isNotEmpty);
    expect(RemotePhotoBackbone.frontendMilestones, isNotEmpty);
    expect(RemotePhotoBackbone.acceptanceGates, isNotEmpty);
  });
}

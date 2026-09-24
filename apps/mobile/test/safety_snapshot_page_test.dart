import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/safety_snapshot.dart';
import 'package:guardian/screens/safety_snapshot_page.dart';
import 'package:guardian/services/safety_snapshot_service.dart';

class FakePhotos extends SafetySnapshotService {
  FakePhotos()
    : super(baseUrl: 'https://gateway.example', token: () async => 'token');
  int requests = 0;
  bool online = true;
  @override
  Future<SnapshotFeed> load(String imei) async => SnapshotFeed(
    cameraAvailable: true,
    online: online,
    items: requests == 0
        ? []
        : [
            SafetySnapshot.fromFirestore('one', {
              'imei': imei,
              'state': 'waiting_for_image',
              'purpose': 'Check surroundings',
              'createdAt': DateTime.now(),
            }),
          ],
  );
  @override
  Future<String> requestSnapshot({
    required String imei,
    required String purpose,
    required bool consentConfirmed,
    required bool safetyPurposeConfirmed,
  }) async {
    expect(consentConfirmed && safetyPurposeConfirmed, isTrue);
    requests++;
    return 'one';
  }
}

void main() {
  testWidgets(
    'compact screen requires consent and shows waiting until an image arrives',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = FakePhotos();
      addTearDown(service.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: SafetySnapshotPage(
            imei: '861397052547492',
            name: 'Jesh',
            service: service,
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.text('Take photo'));
      await tester.pumpAndSettle();
      final confirm = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(FilledButton, 'Take photo'),
      );
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();
      await tester.tap(confirm);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(service.requests, 1);
      expect(find.text('Taking photo…'), findsWidgets);
      expect(find.byType(Image), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets('offline watch disables capture', (tester) async {
    final service = FakePhotos()..online = false;
    addTearDown(service.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: SafetySnapshotPage(
          imei: '861397052547492',
          name: 'Jesh',
          service: service,
        ),
      ),
    );
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Take photo'))
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

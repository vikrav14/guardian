import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/safety_snapshot.dart';
import 'package:guardian/screens/safety_snapshot_page.dart';
import 'package:guardian/services/safety_snapshot_service.dart';

class FakePhotos extends SafetySnapshotService {
  FakePhotos()
    : super(baseUrl: 'https://gateway.example', token: () async => 'token');
  int requests = 0;
  int loads = 0;
  Completer<SnapshotFeed>? firstLoad;
  bool online = true;
  @override
  Future<SnapshotFeed> load(String imei) async {
    loads++;
    if (loads == 1 && firstLoad != null) return firstLoad!.future;
    return SnapshotFeed(
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
  }

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
    'stalled load exposes retry and recovers without a camera request',
    (tester) async {
      final stalled = Completer<SnapshotFeed>();
      final service = FakePhotos()..firstLoad = stalled;
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
      expect(find.text('Connecting to the photo service…'), findsOneWidget);
      await tester.pump(const Duration(seconds: 36));
      expect(find.text('Retry connection'), findsOneWidget);
      expect(find.text('Connecting to the photo service…'), findsNothing);
      await tester.pump(const Duration(seconds: 60));
      expect(service.loads, 1);
      await tester.tap(find.text('Retry connection'));
      await tester.pump();
      expect(service.loads, 2);
      expect(service.requests, 0);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Take photo'),
            )
            .onPressed,
        isNotNull,
      );
      stalled.complete(
        const SnapshotFeed(items: [], cameraAvailable: false, online: false),
      );
      await tester.pump();
      expect(find.text('Take one photo from Jesh’s watch.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('returning during an old load promptly refreshes the status', (
    tester,
  ) async {
    final stalled = Completer<SnapshotFeed>();
    final service = FakePhotos()..firstLoad = stalled;
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
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.text('Connecting to the photo service…'), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    stalled.complete(
      const SnapshotFeed(items: [], cameraAvailable: true, online: true),
    );
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(service.loads, 2);
    expect(service.requests, 0);
    expect(find.text('Take one photo from Jesh’s watch.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

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

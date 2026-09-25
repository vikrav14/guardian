import 'dart:async';
import 'dart:typed_data';

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
  Completer<SnapshotFeed>? nextLoad;
  SnapshotFeed? feed;
  int imageLoads = 0;
  bool online = true;
  @override
  Future<SnapshotFeed> load(String imei) async {
    loads++;
    if (loads == 1 && firstLoad != null) return firstLoad!.future;
    if (nextLoad != null) {
      final pending = nextLoad!;
      nextLoad = null;
      return pending.future;
    }
    if (feed != null) return feed!;
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
  Future<Uint8List> loadImage(String id) {
    imageLoads++;
    return Completer<Uint8List>().future;
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
  testWidgets('failed request history stays visible across focus changes', (
    tester,
  ) async {
    final service = FakePhotos()
      ..feed = SnapshotFeed(
        cameraAvailable: true,
        online: true,
        items: [
          SafetySnapshot.fromFirestore('failed', {
            'imei': '861397052547492',
            'state': 'failed',
            'createdAt': DateTime(2026, 9, 25, 16, 55),
          }),
        ],
      );
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
    expect(find.text('No photo received'), findsOneWidget);
    expect(find.text('Requested 25 Sep, 16:55:00'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.text('No photo received'), findsOneWidget);
    final resumed = Completer<SnapshotFeed>();
    service.nextLoad = resumed;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.text('No photo received'), findsOneWidget);
    expect(find.text('Connecting to the photo service…'), findsNothing);
    expect(find.text('Updating photo status…'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Take photo'))
          .onPressed,
      isNull,
    );
    resumed.complete(service.feed!);
    await tester.pump();
    expect(find.text('No photo received'), findsOneWidget);
    expect(find.text('Updating photo status…'), findsNothing);
    expect(service.requests, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('backgrounding hides images until fresh access succeeds', (
    tester,
  ) async {
    final service = FakePhotos()
      ..feed = SnapshotFeed(
        cameraAvailable: true,
        online: true,
        items: [
          SafetySnapshot.fromFirestore('photo', {
            'imei': '861397052547492',
            'state': 'available',
            'mediaExpiresAt': DateTime.now().add(const Duration(hours: 1)),
          }),
        ],
      );
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
    expect(service.imageLoads, 1);
    expect(find.byType(FutureBuilder<Uint8List>), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.byType(FutureBuilder<Uint8List>), findsNothing);
    expect(find.byType(Image), findsNothing);
    expect(service.imageLoads, 1);
    final resumed = Completer<SnapshotFeed>();
    service.nextLoad = resumed;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.byType(FutureBuilder<Uint8List>), findsNothing);
    expect(service.imageLoads, 1);
    resumed.completeError(const SnapshotFailure('forbidden'));
    await tester.pump();
    expect(find.text('Retry connection'), findsOneWidget);
    expect(find.byType(FutureBuilder<Uint8List>), findsNothing);
    expect(service.imageLoads, 1);
    expect(service.requests, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });

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

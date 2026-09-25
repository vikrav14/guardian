import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/incident_photos.dart';
import 'package:guardian/screens/incident_photo_page.dart';
import 'package:guardian/services/safety_snapshot_service.dart';

class FakeIncidentPhotos extends SafetySnapshotService {
  FakeIncidentPhotos()
    : super(baseUrl: 'https://gateway.example', token: () async => 'token');
  int imageLoads = 0;
  int requests = 0;
  bool denied = false;
  bool deleted = false;
  Completer<IncidentPhotoFeed>? pending;
  @override
  Future<IncidentPhotoFeed> loadIncident(String id) async {
    if (denied) throw const SnapshotFailure('family_membership_not_verified');
    if (pending != null) {
      final next = pending!;
      pending = null;
      return next.future;
    }
    return IncidentPhotoFeed(
      type: 'sos',
      state: 'collecting',
      photos: [
        IncidentPhoto(
          id: 'photo-one',
          sequence: 1,
          state: deleted ? 'deleted' : 'available',
          receivedAt: DateTime.now(),
          expiresAt: DateTime.now().add(const Duration(hours: 1)),
          analysis: {
            'status': 'ready',
            'visibleDetails': ['A chair is visible.'],
            'uncertainDetails': ['An object may be a table.'],
            'limitations': ['The view is blurred.'],
          },
        ),
      ],
    );
  }

  @override
  Future<Uint8List> loadImage(String id) {
    imageLoads++;
    return Completer<Uint8List>().future;
  }

  @override
  Future<void> delete(String id) async {
    deleted = true;
  }

  @override
  Future<String> requestSnapshot({
    required String imei,
    required String purpose,
    required bool consentConfirmed,
    required bool safetyPurposeConfirmed,
  }) async {
    requests++;
    return 'unexpected';
  }
}

void main() {
  test('incident URLs contain an identifier only and reject malformed IDs', () {
    expect(
      incidentFromUri(Uri.parse('https://guardian.example/?incident=abc_123')),
      'abc_123',
    );
    expect(
      incidentFromUri(
        Uri.parse('https://guardian.example/?incident=../secret'),
      ),
      isNull,
    );
    expect(incidentFromUri(Uri.parse('https://guardian.example/')), isNull);
  });
  testWidgets(
    'gallery is read-only and shows progress, source basis and per-photo uncertainty',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = FakeIncidentPhotos();
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident1', service: service),
        ),
      );
      await tester.pump();
      expect(find.text('1 of up to 5 photos available'), findsOneWidget);
      expect(find.text('Guardian AI photo insights'), findsOneWidget);
      expect(find.text('• An object may be a table.'), findsOneWidget);
      expect(find.text('Take photo'), findsNothing);
      expect(service.requests, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'backgrounding hides image and AI, and a failed foreground access check stays private',
    (tester) async {
      final service = FakeIncidentPhotos();
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident1', service: service),
        ),
      );
      await tester.pump();
      expect(find.text('Guardian AI photo insights'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.inactive,
      );
      await tester.pump();
      expect(find.text('Guardian AI photo insights'), findsNothing);
      expect(find.textContaining('Photo 1: A chair'), findsNothing);
      service.denied = true;
      tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Guardian AI photo insights'), findsNothing);
      expect(
        find.text('Photo access could not be verified for this watch.'),
        findsOneWidget,
      );
      expect(service.requests, 0);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('deleting a photo removes its scene description too', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final service = FakeIncidentPhotos();
    await tester.pumpWidget(
      MaterialApp(
        home: IncidentPhotoPage(incidentId: 'incident1', service: service),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('Delete photo & AI details'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Deleted'), findsOneWidget);
    expect(find.text('Guardian AI photo insights'), findsNothing);
    expect(find.textContaining('Photo 1: A chair'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
}

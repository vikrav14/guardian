import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;
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
  Uint8List? imageBytes;
  Map<String, dynamic>? orientation;
  Map<String, dynamic>? analysisOverride;
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
          analysis:
              analysisOverride ??
              {
                'status': 'ready',
                'basis': 'original_photo',
                if (orientation != null) 'orientation': orientation,
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
    if (imageBytes != null) return Future.value(imageBytes!);
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

  test(
    'only clear, valid original-photo orientation can drive automatic rotation',
    () {
      IncidentPhoto photo(Map<String, dynamic>? analysis) => IncidentPhoto(
        id: 'photo-one',
        sequence: 1,
        state: 'available',
        analysis: analysis,
      );
      for (final degrees in [0, 90, 180, 270]) {
        expect(
          photo({
            'status': 'too_unclear',
            'basis': 'original_photo',
            'orientation': {'clockwiseDegrees': degrees, 'confidence': 'high'},
          }).suggestedQuarterTurns,
          degrees ~/ 90,
        );
      }
      for (final orientation in [
        null,
        '90',
        {},
        {'clockwiseDegrees': 90, 'confidence': 'low'},
        {'clockwiseDegrees': '90', 'confidence': 'high'},
        {'clockwiseDegrees': 45, 'confidence': 'high'},
        {'clockwiseDegrees': -90, 'confidence': 'high'},
      ]) {
        expect(
          photo({
            'status': 'ready',
            'basis': 'original_photo',
            'orientation': orientation,
          }).suggestedQuarterTurns,
          isNull,
        );
      }
      expect(photo(null).suggestedQuarterTurns, isNull);
      expect(
        photo({
          'status': 'unavailable',
          'basis': 'original_photo',
          'orientation': {'clockwiseDegrees': 90, 'confidence': 'high'},
        }).suggestedQuarterTurns,
        isNull,
      );
    },
  );

  testWidgets(
    'late automatic rotation respects manual choices, foreground privacy and Original',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final bytes = (await tester.runAsync(() async {
        final recorder = ui.PictureRecorder();
        final canvas = Canvas(recorder);
        canvas.drawRect(
          const Rect.fromLTWH(0, 0, 120, 80),
          Paint()..color = Colors.blue,
        );
        final picture = recorder.endRecording();
        final image = await picture.toImage(120, 80);
        final bytes = (await image.toByteData(
          format: ui.ImageByteFormat.png,
        ))!.buffer.asUint8List();
        image.dispose();
        picture.dispose();
        return bytes;
      }))!;
      final service = FakeIncidentPhotos()..imageBytes = bytes;
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident1', service: service),
        ),
      );
      await tester.pump();
      await tester.runAsync(() async {
        await precacheImage(
          MemoryImage(bytes),
          tester.element(find.byType(IncidentPhotoPage)),
        );
      });
      await tester.pumpAndSettle();
      int turns() =>
          tester.widget<RotatedBox>(find.byType(RotatedBox)).quarterTurns;
      expect(turns(), 0);
      expect(tester.widget<RawImage>(find.byType(RawImage)).image, isNotNull);
      service.orientation = {'clockwiseDegrees': 90, 'confidence': 'high'};
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(turns(), 1);
      expect(find.text('Auto-rotated • original preserved'), findsOneWidget);
      await tester.tap(find.text('Original'));
      await tester.pump();
      service.orientation = {'clockwiseDegrees': 180, 'confidence': 'high'};
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(turns(), 0, reason: 'late suggestions must not undo Original');
      await tester.tap(find.text('Rotate'));
      await tester.pump();
      expect(turns(), 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(find.byType(RotatedBox), findsNothing);
      expect(find.text('Guardian AI photo insights'), findsNothing);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();
      await tester.runAsync(() async {
        await precacheImage(
          MemoryImage(bytes),
          tester.element(find.byType(IncidentPhotoPage)),
        );
      });
      await tester.pumpAndSettle();
      expect(
        turns(),
        1,
        reason: 'the user view survives foreground access checks',
      );
      await tester.tap(find.text('Auto rotate'));
      await tester.pump();
      expect(turns(), 2);
      final slider = tester.widget<Slider>(find.byType(Slider));
      slider.onChanged!(30);
      await tester.pump();
      await tester.tap(find.text('Original'));
      await tester.pump();
      expect(turns(), 0);
      expect(tester.widget<Slider>(find.byType(Slider)).value, 0);
      service.analysisOverride = {
        'status': 'ready',
        'basis': 'rotated_original_photo',
        'summary': 'A chair is visible.',
        'visibleDetails': <String>[],
        'uncertainDetails': <String>[],
        'limitations': <String>[],
        'inputRotationClockwiseDegrees': 270,
        'orientationReference': 'analysis_input',
        'orientation': {'clockwiseDegrees': null, 'confidence': 'low'},
        'orientationSelection': {
          'method': 'four_views_then_description',
          'clockwiseDegrees': 270,
          'confidence': 'high',
          'verification': 'uncertain',
        },
      };
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(turns(), 0, reason: 'new processing must respect Original');
      await tester.tap(find.text('Auto rotate'));
      await tester.pump();
      expect(turns(), 3, reason: 'apply the selected input rotation');
      expect(
        (tester.widget<Image>(find.byType(Image)).image as MemoryImage).bytes,
        same(bytes),
      );
      expect(service.requests, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  test('selected viewing rotation allows abstention but blocks conflicts', () {
    final base = <String, dynamic>{
      'status': 'ready',
      'basis': 'rotated_original_photo',
      'inputRotationClockwiseDegrees': 270,
      'orientationReference': 'analysis_input',
      'orientation': {'clockwiseDegrees': 0, 'confidence': 'high'},
      'orientationSelection': {
        'method': 'four_views_then_description',
        'clockwiseDegrees': 270,
        'confidence': 'high',
      },
    };
    int? turns(Map<String, dynamic> analysis) => IncidentPhoto(
      id: 'photo-one',
      sequence: 1,
      state: 'available',
      analysis: analysis,
    ).suggestedQuarterTurns;
    expect(turns(base), 3);
    final selection = base['orientationSelection'] as Map<String, dynamic>;
    final uncertain = {
      ...base,
      'orientation': {'clockwiseDegrees': null, 'confidence': 'low'},
      'orientationSelection': {...selection, 'verification': 'uncertain'},
    };
    expect(turns(uncertain), 3);
    expect(turns({...uncertain, 'orientation': null}), 3);
    for (final change in [
      {
        'orientationSelection': {...selection, 'confidence': 'low'},
      },
      {
        'orientationSelection': {...selection, 'verification': 'conflicting'},
      },
      {
        'orientationSelection': {...selection, 'verification': 'unknown'},
      },
      {
        'orientation': {'clockwiseDegrees': 90, 'confidence': 'high'},
      },
      {
        'orientation': {'clockwiseDegrees': 0, 'confidence': 'low'},
      },
    ]) {
      expect(turns({...uncertain, ...change}), isNull);
    }
    for (final change in [
      {'orientationSelection': null},
      {'orientationReference': 'original_photo'},
      {'inputRotationClockwiseDegrees': 90},
      {'inputRotationClockwiseDegrees': '270'},
      {'basis': 'unknown'},
      {
        'orientationSelection': {
          'method': 'four_views_then_description',
          'clockwiseDegrees': 270,
          'confidence': 'high',
          'verification': 'conflicting',
        },
      },
      {
        'orientation': {'clockwiseDegrees': 90, 'confidence': 'high'},
      },
      {
        'orientation': {'clockwiseDegrees': 0, 'confidence': 'low'},
      },
      {'status': 'unavailable'},
    ]) {
      expect(turns({...base, ...change}), isNull);
    }
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
      expect(find.text('A chair is visible.'), findsOneWidget);
      expect(find.text('An object may be a table.'), findsOneWidget);
      expect(find.text('Take photo'), findsNothing);
      expect(service.requests, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'scene summary leads with caveats visible and extra detail optional',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = FakeIncidentPhotos()
        ..analysisOverride = {
          'status': 'ready',
          'basis': 'rotated_original_photo',
          'inputRotationClockwiseDegrees': 270,
          'orientationReference': 'analysis_input',
          'orientation': {'clockwiseDegrees': 90, 'confidence': 'high'},
          'orientationSelection': {
            'method': 'four_views_then_description',
            'clockwiseDegrees': 270,
            'confidence': 'high',
            'verification': 'conflicting',
          },
          'summary': 'A chair stands beside a window.',
          'visibleDetails': ['A curtain is visible.'],
          'uncertainDetails': ['A small object may be a bag.'],
          'limitations': [
            'Fine details are blurred.',
            'The view is partly obstructed.',
          ],
        };
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident1', service: service),
        ),
      );
      await tester.pump();
      expect(find.text('A chair stands beside a window.'), findsOneWidget);
      expect(
        find.text(
          'Automatic orientation is uncertain. Use Rotate to adjust the view.',
        ),
        findsOneWidget,
      );
      expect(find.text('Auto rotate'), findsNothing);
      expect(find.text('A small object may be a bag.'), findsOneWidget);
      expect(find.text('Fine details are blurred.'), findsOneWidget);
      expect(find.text('• A curtain is visible.'), findsNothing);
      await tester.tap(find.text('More photo details'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('• A curtain is visible.'), findsOneWidget);
      expect(find.text('• The view is partly obstructed.'), findsOneWidget);
      service.analysisOverride!['visibleDetails'] = <String>[];
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(
        find.text('Photo 1: A chair stands beside a window.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(find.text('A chair stands beside a window.'), findsNothing);
      expect(find.text('• A curtain is visible.'), findsNothing);
      expect(service.requests, 0);
      await tester.pumpWidget(const SizedBox());
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    },
  );
  testWidgets(
    'unreadable imagery describes visibility without an assessment label',
    (tester) async {
      final service = FakeIncidentPhotos()
        ..analysisOverride = {
          'status': 'too_unclear',
          'summary': 'The image is almost entirely dark.',
          'visibleDetails': <String>[],
          'uncertainDetails': <String>[],
          'limitations': ['Objects cannot be distinguished.'],
        };
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident1', service: service),
        ),
      );
      await tester.pump();
      expect(find.text('Limited visual detail'), findsOneWidget);
      expect(find.text('The image is almost entirely dark.'), findsOneWidget);
      expect(find.text('Too unclear to assess'), findsNothing);
      expect(find.text('More photo details'), findsNothing);
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
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(find.text('Guardian AI photo insights'), findsNothing);
      expect(find.textContaining('Photo 1: A chair'), findsNothing);
      service.denied = true;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
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
  testWidgets('a late status response cannot restore deleted AI details', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final service = FakeIncidentPhotos();
    final oldFeed = await service.loadIncident('incident1');
    await tester.pumpWidget(
      MaterialApp(
        home: IncidentPhotoPage(incidentId: 'incident1', service: service),
      ),
    );
    await tester.pump();
    final delayed = Completer<IncidentPhotoFeed>();
    service.pending = delayed;
    await tester.pump(const Duration(seconds: 3));
    await tester.tap(find.text('Delete photo & AI details'));
    await tester.pump();
    expect(find.text('Guardian AI photo insights'), findsNothing);
    delayed.complete(oldFeed);
    await tester.pump();
    await tester.pump();
    expect(find.text('Guardian AI photo insights'), findsNothing);
    expect(find.text('Deleted'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}

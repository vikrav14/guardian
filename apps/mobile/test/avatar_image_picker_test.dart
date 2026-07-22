import 'dart:async';
import 'dart:typed_data';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/account_page.dart';
import 'package:guardian/services/avatar_image_picker.dart';
import 'package:guardian/services/avatar_upload.dart';
import 'package:guardian/services/guardian_avatar_service.dart';

class _FakeAvatarImagePicker implements AvatarImagePicker {
  _FakeAvatarImagePicker(this.result);

  final AvatarImage? result;
  int calls = 0;

  @override
  Future<AvatarImage?> pick() async {
    calls++;
    return result;
  }
}

class _ThrowingAvatarImagePicker implements AvatarImagePicker {
  @override
  Future<AvatarImage?> pick() => Future.error(Exception('read failed'));
}

class _PendingAvatarImagePicker implements AvatarImagePicker {
  @override
  Future<AvatarImage?> pick() => Completer<AvatarImage?>().future;
}

class _ControlledAvatarImagePicker implements AvatarImagePicker {
  final result = Completer<AvatarImage?>();

  @override
  Future<AvatarImage?> pick() => result.future;
}

class _FakeAvatarUploadTransport implements AvatarUploadTransport {
  _FakeAvatarUploadTransport(this.handler);

  final Future<String> Function(AvatarUploadRequest request) handler;

  @override
  bool get requiresIdToken => true;

  @override
  Future<String> upload(AvatarUploadRequest request) => handler(request);
}

AvatarImage get _image => AvatarImage(
  bytes: Uint8List.fromList(<int>[1, 2, 3]),
  mimeType: 'image/png',
  filename: 'avatar.png',
);

void main() {
  test(
    'avatar selection returns a picked web-compatible byte payload',
    () async {
      final image = _image;
      final picker = _FakeAvatarImagePicker(image);

      final selected = await AvatarImageSelection(picker: picker).pick();

      expect(selected, same(image));
      expect(selected!.mimeType, 'image/png');
      expect(selected.filename, 'avatar.png');
      expect(picker.calls, 1);
    },
  );

  test('avatar selection handles a cancelled file chooser', () async {
    final picker = _FakeAvatarImagePicker(null);

    expect(await AvatarImageSelection(picker: picker).pick(), isNull);
    expect(picker.calls, 1);
  });

  test('avatar selection rejects files larger than 5 MB', () async {
    final picker = _FakeAvatarImagePicker(
      AvatarImage(
        bytes: Uint8List(AvatarImageSelection.maxBytes + 1),
        mimeType: 'image/jpeg',
        filename: 'too-large.jpg',
      ),
    );

    expect(
      () => AvatarImageSelection(picker: picker).pick(),
      throwsA(
        isA<AvatarImagePickerException>().having(
          (error) => error.message,
          'message',
          '[read] Please choose an image smaller than 5 MB.',
        ),
      ),
    );
  });

  test('avatar selection accepts files exactly 5 MB', () async {
    final image = AvatarImage(
      bytes: Uint8List(AvatarImageSelection.maxBytes),
      mimeType: 'image/webp',
      filename: 'avatar.webp',
    );

    expect(
      await AvatarImageSelection(picker: _FakeAvatarImagePicker(image)).pick(),
      same(image),
    );
  });

  test('avatar selection reports picker/read failures clearly', () async {
    expect(
      AvatarImageSelection(picker: _ThrowingAvatarImagePicker()).pick,
      throwsA(
        isA<AvatarImagePickerException>().having(
          (error) => error.message,
          'message',
          allOf(contains('[read]'), contains('could not be read')),
        ),
      ),
    );
  });

  test('avatar selection cannot remain pending indefinitely', () async {
    final selection = AvatarImageSelection(
      picker: _PendingAvatarImagePicker(),
      pickerTimeout: const Duration(milliseconds: 1),
    );

    expect(
      selection.pick,
      throwsA(
        isA<AvatarImagePickerException>().having(
          (error) => error.message,
          'message',
          contains('did not finish'),
        ),
      ),
    );
  });

  test('guardian upload cancellation skips upload and save', () async {
    var uploadCalls = 0;
    var saveCalls = 0;
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(null),
      ),
      upload: (_, _) async {
        uploadCalls++;
        return 'https://example.com/avatar.png';
      },
      saveAvatarUrl: (_) async => saveCalls++,
    );

    expect(await service.chooseAndUpload(), isFalse);
    expect(uploadCalls, 0);
    expect(saveCalls, 0);
  });

  test('guardian upload failure is actionable and does not save', () async {
    var saveCalls = 0;
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) => Future.error(
        FirebaseException(plugin: 'firebase_storage', code: 'unauthorized'),
      ),
      saveAvatarUrl: (_) async => saveCalls++,
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          contains('Deploy storage.rules'),
        ),
      ),
    );
    expect(saveCalls, 0);
  });

  test('guardian upload timeout is actionable and does not save', () async {
    var saveCalls = 0;
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) => Completer<String>().future,
      saveAvatarUrl: (_) async => saveCalls++,
      uploadTimeout: const Duration(milliseconds: 1),
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          contains('upload timed out'),
        ),
      ),
    );
    expect(saveCalls, 0);
  });

  test('guardian Firestore save timeout is actionable', () async {
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) async => 'https://example.com/avatar.png?token=test',
      saveAvatarUrl: (_) => Completer<void>().future,
      saveTimeout: const Duration(milliseconds: 1),
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          contains('saving it to your profile timed out'),
        ),
      ),
    );
  });

  test('web upload transport success sends auth, path, and progress', () async {
    AvatarUploadRequest? captured;
    String? savedUrl;
    final progress = <double?>[];
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      uploadTransport: _FakeAvatarUploadTransport((request) async {
        captured = request;
        request.onProgress(0.5);
        request.onProgress(1);
        return 'https://example.com/avatar.png?token=test';
      }),
      idTokenProvider: () async => 'test-id-token',
      storageBucket: 'guardian-fbadd.firebasestorage.app',
      saveAvatarUrl: (url) async => savedUrl = url,
    );

    expect(
      await service.chooseAndUpload(
        onProgress: (update) {
          if (update.stage == AvatarUpdateStage.upload) {
            progress.add(update.fraction);
          }
        },
      ),
      isTrue,
    );
    expect(captured?.idToken, 'test-id-token');
    expect(captured?.bucket, 'guardian-fbadd.firebasestorage.app');
    expect(captured?.objectPath, 'guardianAvatars/guardian-1/avatar');
    expect(progress, containsAllInOrder(<double?>[0, 0.5, 1]));
    expect(savedUrl, contains('v='));
  });

  test('web upload HTTP 403 is actionable and does not save', () async {
    var saveCalls = 0;
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      uploadTransport: _FakeAvatarUploadTransport(
        (_) => Future.error(
          const AvatarUploadTransportException(
            AvatarUploadFailureKind.http,
            'Firebase Storage rejected the upload (HTTP 403): Permission denied',
            statusCode: 403,
          ),
        ),
      ),
      idTokenProvider: () async => 'test-id-token',
      storageBucket: 'guardian-fbadd.firebasestorage.app',
      saveAvatarUrl: (_) async => saveCalls++,
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          allOf(
            contains('[upload]'),
            contains('HTTP 403'),
            contains('guardianAvatars rule'),
          ),
        ),
      ),
    );
    expect(saveCalls, 0);
  });

  test('web upload network failure is surfaced with stage context', () async {
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      uploadTransport: _FakeAvatarUploadTransport(
        (_) => Future.error(
          const AvatarUploadTransportException(
            AvatarUploadFailureKind.network,
            'The browser could not reach Firebase Storage. Check the Network panel.',
          ),
        ),
      ),
      idTokenProvider: () async => 'test-id-token',
      storageBucket: 'guardian-fbadd.firebasestorage.app',
      saveAvatarUrl: (_) async {},
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          allOf(contains('[upload]'), contains('Network panel')),
        ),
      ),
    );
  });

  test('web upload transport cannot remain pending', () async {
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      uploadTransport: _FakeAvatarUploadTransport(
        (_) => Completer<String>().future,
      ),
      idTokenProvider: () async => 'test-id-token',
      storageBucket: 'guardian-fbadd.firebasestorage.app',
      saveAvatarUrl: (_) async {},
      uploadTimeout: const Duration(milliseconds: 10),
    );

    expect(
      service.chooseAndUpload,
      throwsA(
        isA<AvatarUpdateException>().having(
          (error) => error.message,
          'message',
          allOf(contains('[upload]'), contains('timed out')),
        ),
      ),
    );
  });

  testWidgets('Account avatar busy state clears after upload failure', (
    tester,
  ) async {
    final upload = Completer<String>();
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) => upload.future,
      saveAvatarUrl: (_) async {},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountAvatarEditor(
            initials: 'GU',
            service: service,
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Add photo'));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    upload.completeError(
      FirebaseException(plugin: 'firebase_storage', code: 'unauthorized'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('Deploy storage.rules'), findsOneWidget);
  });

  testWidgets(
    'Account shows chooser guidance without spinner during delayed selection',
    (tester) async {
      final picker = _ControlledAvatarImagePicker();
      final upload = Completer<String>();
      final service = GuardianAvatarService(
        currentUserId: () => 'guardian-1',
        imageSelection: AvatarImageSelection(picker: picker),
        upload: (_, _) => upload.future,
        saveAvatarUrl: (_) async {},
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccountAvatarEditor(
              initials: 'GU',
              service: service,
              avatarUrls: Stream<String?>.value(null),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Add photo'));
      await tester.pump();
      expect(find.textContaining('Photo chooser open'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      picker.result.complete(_image);
      await tester.pump();
      expect(find.textContaining('Uploading photo'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      upload.complete('https://example.com/avatar.png');
      await tester.pumpAndSettle();
    },
  );

  testWidgets('Account resets after picker never resolves', (tester) async {
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _PendingAvatarImagePicker(),
        pickerTimeout: const Duration(milliseconds: 10),
      ),
      upload: (_, _) async => 'https://example.com/avatar.png',
      saveAvatarUrl: (_) async {},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountAvatarEditor(
            initials: 'GU',
            service: service,
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Add photo'));
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('[selection]'), findsOneWidget);
    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Add photo'))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('Account resets after upload timeout', (tester) async {
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) => Completer<String>().future,
      saveAvatarUrl: (_) async {},
      uploadTimeout: const Duration(milliseconds: 10),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountAvatarEditor(
            initials: 'GU',
            service: service,
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Add photo'));
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.textContaining('[upload]'), findsOneWidget);
  });

  testWidgets('Account resets after successful photo update', (tester) async {
    final stages = <AvatarUpdateStage>[];
    final service = GuardianAvatarService(
      currentUserId: () => 'guardian-1',
      imageSelection: AvatarImageSelection(
        picker: _FakeAvatarImagePicker(_image),
      ),
      upload: (_, _) async => 'https://example.com/avatar.png',
      saveAvatarUrl: (_) async {},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountAvatarEditor(
            initials: 'GU',
            service: service,
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    await service.chooseAndUpload(
      onProgress: (progress) => stages.add(progress.stage),
    );
    expect(stages, <AvatarUpdateStage>[
      AvatarUpdateStage.selection,
      AvatarUpdateStage.upload,
      AvatarUpdateStage.profileSave,
    ]);

    await tester.tap(find.text('Add photo'));
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Profile photo updated'), findsOneWidget);
    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Add photo'))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('Account avatar reacts to profile stream updates', (
    tester,
  ) async {
    final controller = StreamController<String?>();
    addTearDown(controller.close);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AccountAvatarEditor(
            initials: 'GU',
            avatarUrls: controller.stream,
          ),
        ),
      ),
    );

    expect(find.text('Add photo'), findsOneWidget);

    controller.add(
      'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123',
    );
    await tester.pump();

    expect(find.text('Change photo'), findsOneWidget);
    expect(find.text('Remove photo'), findsOneWidget);
  });
}

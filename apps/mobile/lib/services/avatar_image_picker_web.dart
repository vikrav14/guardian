import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'avatar_image_picker.dart';

AvatarImagePicker createAvatarImagePicker() => WebAvatarImagePicker();

class WebAvatarImagePicker implements AvatarImagePicker {
  static const _readTimeout = Duration(seconds: 15);

  @override
  Future<AvatarImage?> pick() async {
    final input = web.HTMLInputElement()
      ..type = 'file'
      ..accept = 'image/*';
    input.style.display = 'none';
    web.document.body?.append(input);

    final result = Completer<AvatarImage?>();
    late final JSFunction changeListener;
    late final JSFunction cancelListener;
    late final JSFunction blurListener;
    late final JSFunction focusListener;
    Timer? focusCheck;
    Timer? safetyTimeout;
    var windowLostFocus = false;

    void cleanUp() {
      focusCheck?.cancel();
      safetyTimeout?.cancel();
      input.removeEventListener('change', changeListener);
      input.removeEventListener('cancel', cancelListener);
      web.window.removeEventListener('blur', blurListener);
      web.window.removeEventListener('focus', focusListener);
      input.remove();
    }

    void complete(AvatarImage? image) {
      if (!result.isCompleted) {
        cleanUp();
        result.complete(image);
      }
    }

    void completeError(Object error, StackTrace stackTrace) {
      if (!result.isCompleted) {
        cleanUp();
        result.completeError(error, stackTrace);
      }
    }

    Future<void> readSelection() async {
      final file = input.files?.item(0);
      if (file == null) {
        complete(null);
        return;
      }

      try {
        final bytes = await _readFile(file);
        complete(
          AvatarImage(
            bytes: bytes,
            mimeType: file.type.isEmpty
                ? _mimeTypeForName(file.name)
                : file.type,
            filename: file.name,
          ),
        );
      } on AvatarImagePickerException catch (error, stackTrace) {
        completeError(error, stackTrace);
      } catch (_, stackTrace) {
        completeError(
          const AvatarImagePickerException(
            '[read] The selected photo could not be read. Try a different image.',
          ),
          stackTrace,
        );
      }
    }

    changeListener = ((web.Event _) {
      unawaited(readSelection());
    }).toJS;
    cancelListener = ((web.Event _) => complete(null)).toJS;
    blurListener = ((web.Event _) {
      windowLostFocus = true;
    }).toJS;
    // Chromium exposes a `cancel` event, but older browsers do not. In those
    // browsers the window regains focus after the chooser closes. Wait briefly
    // so a selection's `change` event wins the race, then treat no file as a
    // cancellation.
    focusListener = ((web.Event _) {
      if (!windowLostFocus) return;
      focusCheck?.cancel();
      focusCheck = Timer(const Duration(milliseconds: 300), () {
        if (input.files?.item(0) == null) complete(null);
      });
    }).toJS;

    input.addEventListener('change', changeListener);
    input.addEventListener('cancel', cancelListener);
    web.window.addEventListener('blur', blurListener);
    web.window.addEventListener('focus', focusListener);
    safetyTimeout = Timer(const Duration(seconds: 90), () {
      completeError(
        const AvatarImagePickerException(
          '[selection] The photo picker did not finish. Close it and try again.',
        ),
        StackTrace.current,
      );
    });
    try {
      input.click();
    } catch (_, stackTrace) {
      completeError(
        const AvatarImagePickerException(
          '[selection] The browser could not open the photo picker. Try again.',
        ),
        stackTrace,
      );
    }
    return result.future;
  }

  Future<Uint8List> _readFile(web.File file) {
    final reader = web.FileReader();
    final result = Completer<Uint8List>();
    late final JSFunction loadListener;
    late final JSFunction errorListener;
    late final JSFunction abortListener;
    Timer? timeout;

    void cleanUp() {
      timeout?.cancel();
      reader.removeEventListener('load', loadListener);
      reader.removeEventListener('error', errorListener);
      reader.removeEventListener('abort', abortListener);
    }

    void complete(Uint8List bytes) {
      if (result.isCompleted) return;
      cleanUp();
      result.complete(bytes);
    }

    void completeError(String message) {
      if (result.isCompleted) return;
      cleanUp();
      result.completeError(
        AvatarImagePickerException(message),
        StackTrace.current,
      );
    }

    loadListener = ((web.Event _) {
      final value = reader.result;
      if (value == null || !value.isA<JSArrayBuffer>()) {
        completeError('[read] The browser returned invalid photo data.');
        return;
      }
      complete(Uint8List.view((value as JSArrayBuffer).toDart));
    }).toJS;
    errorListener = ((web.Event _) {
      completeError('[read] The browser reported an error reading the photo.');
    }).toJS;
    abortListener = ((web.Event _) {
      completeError('[read] The browser aborted reading the photo.');
    }).toJS;

    reader.addEventListener('load', loadListener);
    reader.addEventListener('error', errorListener);
    reader.addEventListener('abort', abortListener);
    timeout = Timer(_readTimeout, () {
      completeError(
        '[read] Reading the selected photo timed out after '
        '${_readTimeout.inSeconds} seconds. Try a smaller image.',
      );
      reader.abort();
    });

    try {
      reader.readAsArrayBuffer(file);
    } catch (_) {
      completeError('[read] The browser could not start reading the photo.');
    }
    return result.future;
  }
}

String _mimeTypeForName(String name) {
  final extension = name.toLowerCase().split('.').last;
  return switch (extension) {
    'png' => 'image/png',
    'webp' => 'image/webp',
    _ => 'image/jpeg',
  };
}

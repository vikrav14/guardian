import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:firebase_storage/firebase_storage.dart';
import 'package:web/web.dart' as web;

import 'avatar_storage_urls.dart';
import 'avatar_upload.dart';

/// Web avoids `firebase_storage_web` `putData`, which stalls at 0% progress.
/// Upload uses authenticated REST `uploadType=media`, then registers a real
/// `firebaseStorageDownloadTokens` value via metadata PATCH when needed.
AvatarUploadTransport createAvatarUploadTransport({FirebaseStorage? storage}) =>
    WebRestAvatarUploadTransport();

class WebRestAvatarUploadTransport implements AvatarUploadTransport {
  @override
  bool get requiresIdToken => true;

  @override
  Future<String> upload(AvatarUploadRequest request) async {
    final token = request.idToken;
    if (token == null || token.isEmpty) {
      throw const AvatarUploadTransportException(
        AvatarUploadFailureKind.invalidResponse,
        'Firebase Auth did not provide an ID token for the upload.',
      );
    }

    final responseBody = await _sendBytes(
      method: 'POST',
      url: buildFirebaseMediaUploadUrl(
        bucket: request.bucket,
        objectPath: request.objectPath,
      ),
      idToken: token,
      contentType: request.contentType,
      body: request.bytes.toJS,
      timeout: request.timeout,
      onProgress: request.onProgress,
      networkErrorMessage:
          'The browser could not reach Firebase Storage. Check the Network '
          'panel for a blocked request or CORS error.',
    );

    var downloadToken = extractDownloadTokenFromMetadataJson(responseBody);
    if (downloadToken == null) {
      downloadToken = generateFirebaseDownloadToken();
      await _sendBytes(
        method: 'PATCH',
        url: buildFirebaseMetadataPatchUrl(
          bucket: request.bucket,
          objectPath: request.objectPath,
        ),
        idToken: token,
        contentType: 'application/json; charset=UTF-8',
        body: jsonEncode(
          buildFirebaseDownloadTokenMetadata(downloadToken),
        ).toJS,
        timeout: request.timeout,
        onProgress: (_) {},
        networkErrorMessage:
            'The browser could not update Firebase Storage metadata for the '
            'uploaded photo.',
      );
    }

    return buildFirebaseTokenizedDownloadUrl(
      bucket: request.bucket,
      objectPath: request.objectPath,
      downloadToken: downloadToken,
    );
  }
}

Future<String> _sendBytes({
  required String method,
  required String url,
  required String idToken,
  required String contentType,
  required JSAny body,
  required Duration timeout,
  required AvatarUploadProgress onProgress,
  required String networkErrorMessage,
}) {
  final xhr = web.XMLHttpRequest();
  final result = Completer<String>();
  final listeners = <(web.EventTarget, String, JSFunction)>[];
  Timer? timeoutTimer;

  void listen(
    web.EventTarget target,
    String type,
    void Function(web.Event) callback,
  ) {
    final listener = callback.toJS;
    target.addEventListener(type, listener);
    listeners.add((target, type, listener));
  }

  void cleanUp() {
    timeoutTimer?.cancel();
    for (final (target, type, listener) in listeners) {
      target.removeEventListener(type, listener);
    }
    listeners.clear();
  }

  void complete(String body) {
    if (result.isCompleted) return;
    cleanUp();
    result.complete(body);
  }

  void fail(AvatarUploadTransportException error) {
    if (result.isCompleted) return;
    cleanUp();
    result.completeError(error, StackTrace.current);
  }

  listen(xhr.upload, 'progress', (event) {
    final progress = event as web.ProgressEvent;
    onProgress(
      progress.lengthComputable && progress.total > 0
          ? progress.loaded / progress.total
          : null,
    );
  });
  listen(xhr, 'load', (_) {
    final status = xhr.status;
    final responseBody = xhr.responseText;
    if (status < 200 || status >= 300) {
      fail(
        AvatarUploadTransportException(
          AvatarUploadFailureKind.http,
          _httpErrorMessage(status, responseBody),
          statusCode: status,
        ),
      );
      return;
    }
    complete(responseBody);
  });
  listen(xhr, 'error', (_) {
    fail(
      AvatarUploadTransportException(
        AvatarUploadFailureKind.network,
        networkErrorMessage,
      ),
    );
  });
  listen(xhr, 'abort', (_) {
    fail(
      const AvatarUploadTransportException(
        AvatarUploadFailureKind.network,
        'The browser aborted the Firebase Storage request.',
      ),
    );
  });
  listen(xhr, 'timeout', (_) {
    fail(
      AvatarUploadTransportException(
        AvatarUploadFailureKind.timeout,
        'The Firebase Storage request timed out after '
        '${timeout.inSeconds} seconds.',
      ),
    );
  });

  try {
    xhr.open(method, url);
    xhr.setRequestHeader('Authorization', 'Firebase $idToken');
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.timeout = timeout.inMilliseconds;
    timeoutTimer = Timer(timeout, () {
      fail(
        AvatarUploadTransportException(
          AvatarUploadFailureKind.timeout,
          'The Firebase Storage request timed out after '
          '${timeout.inSeconds} seconds.',
        ),
      );
      xhr.abort();
    });
    xhr.send(body);
  } catch (error) {
    fail(
      AvatarUploadTransportException(
        AvatarUploadFailureKind.network,
        'The browser could not start the Firebase Storage request: $error',
      ),
    );
  }
  return result.future;
}

String _httpErrorMessage(int status, String body) {
  String? detail;
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      final error = decoded['error'];
      if (error is Map<String, dynamic>) {
        detail = error['message']?.toString();
      } else {
        detail = error?.toString();
      }
    }
  } catch (_) {
    // Fall back to the status-only message below.
  }
  final suffix = detail == null || detail.isEmpty ? '' : ': $detail';
  return 'Firebase Storage rejected the upload (HTTP $status)$suffix';
}

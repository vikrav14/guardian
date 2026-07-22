import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../services/avatar_byte_cache.dart';
import '../../services/avatar_image_loader.dart';
import '../../services/avatar_image_strategy.dart';
import '../../services/avatar_storage_urls.dart';
import '../../services/avatar_ui_image.dart';

class PersonMapMarker {
  static const _pixelSize = 80.0;
  static final Map<String, Future<BitmapDescriptor>> _cache = {};

  static Future<BitmapDescriptor> create({
    required String initials,
    required Color color,
    required bool selected,
    required Color surfaceColor,
    String? imageUrl,
  }) {
    final url = imageUrl?.trim() ?? '';
    final key =
        '$url|$initials|${color.toARGB32()}|$selected|${surfaceColor.toARGB32()}';
    if (_cache.length > 80 && !_cache.containsKey(key)) _cache.clear();
    return _cache.putIfAbsent(
      key,
      () => _render(
        initials: initials,
        color: color,
        selected: selected,
        surfaceColor: surfaceColor,
        imageUrl: url,
      ),
    );
  }

  static Future<BitmapDescriptor> _render({
    required String initials,
    required Color color,
    required bool selected,
    required Color surfaceColor,
    required String imageUrl,
  }) async {
    final pictureRecorder = ui.PictureRecorder();
    final canvas = Canvas(pictureRecorder);
    const center = Offset(_pixelSize / 2, _pixelSize / 2);
    final outerRadius = selected ? 38.0 : 36.0;
    final photoRadius = selected ? 32.0 : 30.0;

    canvas.drawCircle(
      center,
      outerRadius,
      Paint()..color = selected ? color : surfaceColor,
    );
    canvas.drawCircle(center, photoRadius + 2, Paint()..color = color);
    canvas.drawCircle(center, photoRadius, Paint()..color = surfaceColor);

    final image = imageUrl.isEmpty ? null : await _loadImage(imageUrl);
    if (image == null) {
      final painter = TextPainter(
        text: TextSpan(
          text: initials,
          style: TextStyle(
            color: color,
            fontSize: 22,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(
        canvas,
        center - Offset(painter.width / 2, painter.height / 2),
      );
    } else {
      canvas.save();
      canvas.clipPath(
        Path()..addOval(Rect.fromCircle(center: center, radius: photoRadius)),
      );
      paintImage(
        canvas: canvas,
        rect: Rect.fromCircle(center: center, radius: photoRadius),
        image: image,
        fit: BoxFit.cover,
      );
      canvas.restore();
    }

    final rendered = await pictureRecorder.endRecording().toImage(
      _pixelSize.toInt(),
      _pixelSize.toInt(),
    );
    final bytes = await rendered.toByteData(format: ui.ImageByteFormat.png);
    rendered.dispose();
    if (bytes == null) {
      throw StateError('Could not render map marker');
    }
    return BitmapDescriptor.bytes(
      bytes.buffer.asUint8List(),
      imagePixelRatio: 2,
    );
  }

  static Future<ui.Image?> _loadImage(String url) async {
    final cached = AvatarByteCache.get(url);
    if (cached != null) {
      return _decodeImage(cached);
    }

    if (kIsWeb && shouldPreferWebHtmlElementAvatar(url)) {
      if (kDebugMode) {
        debugPrint('Map marker HTML canvas load for $url');
      }
      final htmlImage = await loadAvatarUiImage(url);
      if (htmlImage != null) return htmlImage;
    }

    if (shouldLoadAvatarBytesViaSdk(url)) {
      return _loadViaSdk(url);
    }

    final networkImage = await _loadNetworkImage(url);
    if (networkImage != null) return networkImage;

    if (isFirebaseStorageMediaUrl(url)) {
      return _loadViaSdk(url);
    }

    return null;
  }

  static Future<ui.Image?> _loadViaSdk(String url) async {
    try {
      final bytes = await loadAvatarImageBytes(url);
      if (bytes == null || bytes.isEmpty) {
        if (kDebugMode) {
          debugPrint('Map marker SDK avatar load failed for $url');
        }
        return null;
      }
      AvatarByteCache.put(url, bytes);
      return _decodeImage(bytes);
    } catch (error, stackTrace) {
      if (kDebugMode) {
        debugPrint(
          'Map marker SDK avatar load threw for $url: $error\n$stackTrace',
        );
      }
      return null;
    }
  }

  static Future<ui.Image?> _loadNetworkImage(String url) async {
    final completer = Completer<ui.Image?>();
    final stream = NetworkImage(url).resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;
    listener = ImageStreamListener(
      (info, _) {
        if (!completer.isCompleted) completer.complete(info.image);
        stream.removeListener(listener);
      },
      onError: (error, stackTrace) {
        if (kDebugMode) {
          debugPrint('Map marker network avatar failed for $url: $error');
        }
        if (!completer.isCompleted) completer.complete(null);
        stream.removeListener(listener);
      },
    );
    stream.addListener(listener);
    return completer.future.timeout(
      const Duration(seconds: 8),
      onTimeout: () {
        stream.removeListener(listener);
        return null;
      },
    );
  }

  static Future<ui.Image?> _decodeImage(List<int> bytes) async {
    final completer = Completer<ui.Image?>();
    ui.decodeImageFromList(
      bytes is Uint8List ? bytes : Uint8List.fromList(bytes),
      (image) {
        if (!completer.isCompleted) completer.complete(image);
      },
    );
    return completer.future.timeout(
      const Duration(seconds: 4),
      onTimeout: () => null,
    );
  }
}

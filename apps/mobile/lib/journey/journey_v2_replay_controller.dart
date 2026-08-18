import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/location_history_point.dart';

class JourneyV2ReplayController extends ChangeNotifier {
  JourneyV2ReplayController({
    required List<LocationHistoryPoint> points,
    Duration? replayDuration,
  }) : _points = List<LocationHistoryPoint>.unmodifiable(points),
       _baseReplayDuration =
           replayDuration ?? _defaultReplayDuration(points);

  final List<LocationHistoryPoint> _points;
  final Duration _baseReplayDuration;
  Timer? _timer;
  int _currentIndex = 0;
  double _speed = 1.0;
  bool _isPlaying = false;

  List<LocationHistoryPoint> get points => _points;
  int get pointCount => _points.length;
  int get currentIndex => _currentIndex;
  double get speed => _speed;
  bool get isPlaying => _isPlaying;
  bool get canReplay => _points.length >= 2;
  Duration get replayDuration => Duration(
    milliseconds: (_baseReplayDuration.inMilliseconds / _speed).round(),
  );

  double get progress {
    if (_points.length <= 1) return 0;
    final startAt = _points.first.recordedAt;
    final endAt = _points.last.recordedAt;
    final currentAt = currentPoint?.recordedAt;
    if (startAt == null || endAt == null || currentAt == null) {
      return _currentIndex / (_points.length - 1);
    }

    final startMs = startAt.millisecondsSinceEpoch;
    final endMs = endAt.millisecondsSinceEpoch;
    final spanMs = endMs - startMs;
    if (spanMs <= 0) return _currentIndex / (_points.length - 1);

    final currentMs = currentAt.millisecondsSinceEpoch;
    final value = (currentMs - startMs) / spanMs;
    return value < 0
        ? 0
        : value > 1
        ? 1
        : value;
  }

  LocationHistoryPoint? get currentPoint {
    if (_points.isEmpty) return null;
    final index = _currentIndex < 0
        ? 0
        : _currentIndex >= _points.length
        ? _points.length - 1
        : _currentIndex;
    return _points[index];
  }

  DateTime? get currentTime => currentPoint?.recordedAt;

  String get speedLabel {
    if (_speed == _speed.roundToDouble()) return '${_speed.toInt()}x';
    return '${_speed.toStringAsFixed(1)}x';
  }

  void toggle() {
    if (_isPlaying) {
      pause();
    } else {
      play();
    }
  }

  void play() {
    if (!canReplay) return;

    if (_currentIndex >= _points.length - 1) {
      _currentIndex = 0;
    }

    _isPlaying = true;
    _scheduleNextAdvance();
    notifyListeners();
  }

  void pause() {
    if (!_isPlaying && _timer == null) return;
    _timer?.cancel();
    _timer = null;
    _isPlaying = false;
    notifyListeners();
  }

  void seekProgress(double value) {
    if (_points.isEmpty) return;
    final clamped = value < 0
        ? 0.0
        : value > 1
        ? 1.0
        : value;
    final timelineMs = <int>[];
    for (final point in _points) {
      final pointAt = point.recordedAt;
      if (pointAt == null) {
        _currentIndex = ((_points.length - 1) * clamped).round();
        notifyListeners();
        return;
      }
      timelineMs.add(pointAt.millisecondsSinceEpoch);
    }

    final startMs = timelineMs.first;
    final endMs = timelineMs.last;
    final spanMs = endMs - startMs;
    if (spanMs <= 0) {
      _currentIndex = ((_points.length - 1) * clamped).round();
    } else {
      final targetMs = startMs + (spanMs * clamped).round();
      var nearestIndex = 0;
      var nearestDistance = (timelineMs.first - targetMs).abs();
      for (var index = 1; index < _points.length; index++) {
        final distance = (timelineMs[index] - targetMs).abs();
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      _currentIndex = nearestIndex;
    }
    if (_isPlaying) _scheduleNextAdvance();
    notifyListeners();
  }

  void cycleSpeed() {
    _speed = switch (_speed) {
      1.0 => 2.0,
      2.0 => 4.0,
      _ => 1.0,
    };

    if (_isPlaying) _scheduleNextAdvance();
    notifyListeners();
  }

  void reset() {
    _timer?.cancel();
    _timer = null;
    _isPlaying = false;
    _currentIndex = 0;
    notifyListeners();
  }

  void _scheduleNextAdvance() {
    _timer?.cancel();
    if (!_isPlaying || _currentIndex >= _points.length - 1) return;

    final milliseconds = _nextTransitionMilliseconds();
    _timer = Timer(Duration(milliseconds: milliseconds), _advance);
  }

  int _nextTransitionMilliseconds() {
    final equalShare = 1 / (_points.length - 1);
    var timelineShare = equalShare;

    final firstAt = _points.first.recordedAt;
    final lastAt = _points.last.recordedAt;
    final currentAt = _points[_currentIndex].recordedAt;
    final nextAt = _points[_currentIndex + 1].recordedAt;
    if (firstAt != null &&
        lastAt != null &&
        currentAt != null &&
        nextAt != null) {
      final fullSpanMs = lastAt.difference(firstAt).inMilliseconds;
      final nextSpanMs = nextAt.difference(currentAt).inMilliseconds;
      if (fullSpanMs > 0 && nextSpanMs > 0) {
        timelineShare = nextSpanMs / fullSpanMs;
      }
    }

    final requested =
        (_baseReplayDuration.inMilliseconds * timelineShare / _speed).round();
    return requested.clamp(250, 60000).toInt();
  }

  void _advance() {
    if (!_isPlaying || !canReplay) return;

    if (_currentIndex >= _points.length - 1) {
      _finish();
      return;
    }

    _currentIndex++;
    if (_currentIndex >= _points.length - 1) {
      _finish(notify: false);
    } else {
      _scheduleNextAdvance();
    }
    notifyListeners();
  }

  void _finish({bool notify = true}) {
    _timer?.cancel();
    _timer = null;
    _isPlaying = false;
    if (notify) notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  static Duration _defaultReplayDuration(
    List<LocationHistoryPoint> points,
  ) {
    if (points.length < 2) return Duration.zero;

    final firstAt = points.first.recordedAt;
    final lastAt = points.last.recordedAt;
    if (firstAt != null && lastAt != null) {
      final recordedMs = lastAt.difference(firstAt).inMilliseconds;
      if (recordedMs > 0) {
        // Replay real timing at a calm, useful scale: six recorded seconds
        // become one replay second, bounded so short outings remain readable
        // and long outings do not take several minutes to review.
        final scaledMs = (recordedMs / 6)
            .round()
            .clamp(15000, 60000)
            .toInt();
        return Duration(milliseconds: scaledMs);
      }
    }

    final fallbackMs = ((points.length - 1) * 4000)
        .clamp(12000, 60000)
        .toInt();
    return Duration(milliseconds: fallbackMs);
  }
}

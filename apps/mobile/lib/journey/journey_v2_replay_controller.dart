import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/location_history_point.dart';

class JourneyV2ReplayController extends ChangeNotifier {
  JourneyV2ReplayController({required List<LocationHistoryPoint> points})
    : _points = List<LocationHistoryPoint>.unmodifiable(points);

  final List<LocationHistoryPoint> _points;
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

  double get progress {
    if (_points.length <= 1) return 0;
    return _currentIndex / (_points.length - 1);
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
    _restartTimer();
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
    _currentIndex = ((_points.length - 1) * clamped).round();
    notifyListeners();
  }

  void cycleSpeed() {
    _speed = switch (_speed) {
      1.0 => 2.0,
      2.0 => 4.0,
      _ => 1.0,
    };

    if (_isPlaying) _restartTimer();
    notifyListeners();
  }

  void reset() {
    _timer?.cancel();
    _timer = null;
    _isPlaying = false;
    _currentIndex = 0;
    notifyListeners();
  }

  void _restartTimer() {
    _timer?.cancel();
    final requested = (520 / _speed).round();
    final milliseconds = requested < 90
        ? 90
        : requested > 520
        ? 520
        : requested;
    _timer = Timer.periodic(
      Duration(milliseconds: milliseconds),
      (_) => _advance(),
    );
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
}

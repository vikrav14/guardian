import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/geofence.dart';
import '../models/location_history_point.dart';
import 'journey_models.dart';
import 'journey_utils.dart';

class JourneyReplayController extends ChangeNotifier {
  JourneyReplayController({
    required List<LocationHistoryPoint> rawPoints,
    List<JourneyRecord> journeys = const [],
    List<Geofence> geofences = const [],
    List<JourneyEvent>? timelineEvents,
    JourneyGpsContext? gpsContext,
  })  : rawPoints = List<LocationHistoryPoint>.unmodifiable(rawPoints),
        smoothedPoints = smoothRouteForDisplay(filterOutlierPoints(rawPoints)),
        routeSegments = buildRouteSegments(filterOutlierPoints(rawPoints)),
        displayRouteSegments = buildRouteSegments(
          smoothRouteForDisplay(filterOutlierPoints(rawPoints)),
        ),
        events = timelineEvents ??
            detectJourneyEvents(rawPoints, geofences: geofences),
        stats = buildJourneyStats(rawPoints, journeys: journeys),
        insights = buildJourneyInsights(
          rawPoints,
          geofences: geofences,
          gpsContext: gpsContext,
        ),
        quality = computeJourneyQuality(rawPoints, gpsContext: gpsContext),
        score = computeJourneyScore(
          rawPoints,
          geofences: geofences,
          gpsContext: gpsContext,
        ),
        highlights = computeJourneyHighlights(rawPoints, zones: geofences),
        health = buildJourneyHealthForPoints(
          rawPoints,
          geofences: geofences,
          gpsContext: gpsContext,
        );

  final List<LocationHistoryPoint> rawPoints;
  final List<LocationHistoryPoint> smoothedPoints;
  final List<RouteSegment> routeSegments;
  final List<RouteSegment> displayRouteSegments;
  final List<JourneyEvent> events;
  final JourneyStats stats;
  final JourneyInsights insights;
  final JourneyQuality quality;
  final JourneyScoreBreakdown score;
  final JourneyHighlights highlights;
  final JourneyHealth health;

  static const playbackSpeedOptions = [0.5, 1.0, 2.0, 4.0];

  bool isReplayMode = false;
  bool isPlaying = false;
  bool followCamera = true;
  double progress = 0;
  double playbackSpeed = 1;

  Timer? _timer;
  int _lastCameraIndex = -1;
  int _lastNarratedEventIndex = -1;
  String? _currentNarration;

  int get currentIndex {
    if (smoothedPoints.isEmpty) return 0;
    final maxIndex = smoothedPoints.length - 1;
    return (progress * maxIndex).round().clamp(0, maxIndex);
  }

  int get currentRawIndex {
    if (rawPoints.isEmpty) return 0;
    final maxIndex = rawPoints.length - 1;
    return (progress * maxIndex).round().clamp(0, maxIndex);
  }

  LocationHistoryPoint? get currentPoint {
    if (smoothedPoints.isEmpty) return null;
    return smoothedPoints[currentIndex];
  }

  /// Clockwise degrees from north for the current replay position.
  double? get currentBearing =>
      bearingAtRouteIndex(smoothedPoints, currentIndex);

  List<LocationHistoryPoint> get visibleRoutePoints {
    if (smoothedPoints.isEmpty) return const [];
    return smoothedPoints.sublist(0, currentIndex + 1);
  }

  JourneyEvent? get activeEvent {
    final index = currentRawIndex;
    for (final event in events) {
      if (event.containsIndex(index)) return event;
    }
    return null;
  }

  String? get currentNarration => _currentNarration;

  /// Wall-clock time for a full replay at 1×. Long journeys compress so playback
  /// stays responsive instead of running at real-world duration.
  int get replayDurationMs {
    const maxWallClockMs = 45000;
    const minWallClockMs = 8000;
    final ms = stats.duration.inMilliseconds;
    final base = ms > 0 ? ms : smoothedPoints.length * 500;
    if (base <= maxWallClockMs) {
      return base.clamp(minWallClockMs, maxWallClockMs);
    }
    return maxWallClockMs;
  }

  bool get shouldMoveCamera =>
      followCamera && isReplayMode && currentIndex != _lastCameraIndex;

  void markCameraMoved() => _lastCameraIndex = currentIndex;

  void enterReplayMode() {
    isReplayMode = true;
    progress = 0;
    _lastCameraIndex = -1;
    _lastNarratedEventIndex = -1;
    _currentNarration = null;
    notifyListeners();
  }

  void exitReplayMode() {
    pause();
    isReplayMode = false;
    progress = 0;
    _lastCameraIndex = -1;
    _lastNarratedEventIndex = -1;
    _currentNarration = null;
    notifyListeners();
  }

  void togglePlayPause() {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  void play() {
    if (smoothedPoints.length < 2) return;
    if (!isReplayMode) enterReplayMode();
    _updateNarration(force: true);
    isPlaying = true;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      final durationMs = replayDurationMs;
      final increment = (50 * playbackSpeed) / durationMs;
      progress = (progress + increment).clamp(0.0, 1.0);
      _updateNarration();
      notifyListeners();
      if (progress >= 1.0) {
        pause();
      }
    });
    notifyListeners();
  }

  void pause() {
    isPlaying = false;
    _timer?.cancel();
    _timer = null;
    notifyListeners();
  }

  void seek(double value) {
    final clamped = value.clamp(0.0, 1.0);
    if (clamped > 0 && !isReplayMode) enterReplayMode();
    if (clamped == 0 && !isPlaying) {
      exitReplayMode();
      return;
    }
    progress = clamped;
    _updateNarration(force: true);
    notifyListeners();
  }

  void seekToEvent(JourneyEvent event) {
    seek(eventProgress(event, rawPoints.length));
    if (isPlaying) pause();
  }

  void skipToStart() {
    seek(0);
    if (isPlaying) pause();
  }

  void skipToEnd() {
    seek(1);
    pause();
  }

  void stepBackward() {
    if (events.isEmpty) return;
    final current = activeEvent;
    if (current == null) {
      seekToEvent(events.first);
      return;
    }
    final index = events.indexOf(current);
    if (index <= 0) {
      skipToStart();
      return;
    }
    seekToEvent(events[index - 1]);
  }

  void stepForward() {
    if (events.isEmpty) return;
    final current = activeEvent;
    if (current == null) {
      seekToEvent(events.first);
      return;
    }
    final index = events.indexOf(current);
    if (index >= events.length - 1) {
      skipToEnd();
      return;
    }
    seekToEvent(events[index + 1]);
  }

  void setPlaybackSpeed(double speed) {
    playbackSpeed = speed;
    if (isPlaying) {
      pause();
      play();
    } else {
      notifyListeners();
    }
  }

  void toggleSpeed() {
    final currentIndex = playbackSpeedOptions.indexOf(playbackSpeed);
    final next = currentIndex == -1
        ? 1
        : (currentIndex + 1) % playbackSpeedOptions.length;
    setPlaybackSpeed(playbackSpeedOptions[next]);
  }

  void toggleFollowCamera() {
    followCamera = !followCamera;
    notifyListeners();
  }

  void _updateNarration({bool force = false}) {
    final event = activeEvent;
    if (event == null) return;
    final index = events.indexOf(event);
    if (!force && index == _lastNarratedEventIndex) return;
    _lastNarratedEventIndex = index;
    _currentNarration = narrationForEvent(event, rawPoints);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

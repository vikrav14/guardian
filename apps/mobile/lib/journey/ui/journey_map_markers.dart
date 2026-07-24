import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../journey_models.dart';
import '../journey_replay_controller.dart';
import 'journey_screen_theme.dart';

/// Builds colored map markers: green start, orange stops, red end, blue current.
Set<Marker> buildJourneyColoredMarkers(
  JourneyReplayController replay, {
  bool includeCurrentMarker = true,
}) {
  if (replay.smoothedPoints.isEmpty) return const {};

  final markers = <Marker>{};
  final first = replay.smoothedPoints.first;
  final last = replay.smoothedPoints.last;
  final current = replay.currentPoint;
  final bearing = replay.currentBearing;

  markers.add(
    Marker(
      markerId: const MarkerId('start'),
      position: LatLng(first.lat, first.lng),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      infoWindow: const InfoWindow(title: 'Start'),
      zIndexInt: 1,
    ),
  );

  var stopIndex = 0;
  for (final event in replay.events) {
    if (event.type != JourneyEventType.stopped && event.type != JourneyEventType.dwell) {
      continue;
    }
    if (event.startIndex >= replay.rawPoints.length) continue;
    final point = replay.rawPoints[event.startIndex];
    markers.add(
      Marker(
        markerId: MarkerId('stop_$stopIndex'),
        position: LatLng(point.lat, point.lng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange),
        infoWindow: InfoWindow(title: event.label),
        zIndexInt: 2,
      ),
    );
    stopIndex++;
  }

  if (replay.smoothedPoints.length > 1 && !replay.isReplayMode) {
    markers.add(
      Marker(
        markerId: const MarkerId('end'),
        position: LatLng(last.lat, last.lng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        infoWindow: const InfoWindow(title: 'End'),
        zIndexInt: 1,
      ),
    );
  }

  if (includeCurrentMarker && replay.isReplayMode && current != null) {
    markers.add(
      Marker(
        markerId: const MarkerId('replay'),
        position: LatLng(current.lat, current.lng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        rotation: bearing ?? 0,
        flat: true,
        zIndexInt: 3,
        anchor: const Offset(0.5, 0.5),
      ),
    );
  }

  return markers;
}

/// Web overlay: pulsing directional dot at current replay position.
class JourneyReplayPulseOverlay extends StatefulWidget {
  const JourneyReplayPulseOverlay({
    super.key,
    required this.controller,
    required this.replay,
    required this.cameraGeneration,
  });

  final GoogleMapController? controller;
  final JourneyReplayController replay;
  final int cameraGeneration;

  @override
  State<JourneyReplayPulseOverlay> createState() => _JourneyReplayPulseOverlayState();
}

class _JourneyReplayPulseOverlayState extends State<JourneyReplayPulseOverlay>
    with SingleTickerProviderStateMixin {
  Offset? _position;
  var _trackedGeneration = -1;
  var _trackedIndex = -1;
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
    unawaited(_updatePosition());
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant JourneyReplayPulseOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.controller != oldWidget.controller ||
        widget.cameraGeneration != _trackedGeneration ||
        widget.replay.currentIndex != _trackedIndex) {
      unawaited(_updatePosition());
    }
  }

  Future<void> _updatePosition() async {
    final controller = widget.controller;
    final point = widget.replay.currentPoint;
    if (controller == null ||
        point == null ||
        !widget.replay.isReplayMode ||
        !mounted) {
      setState(() => _position = null);
      return;
    }

    _trackedGeneration = widget.cameraGeneration;
    _trackedIndex = widget.replay.currentIndex;
    try {
      final screen = await controller.getScreenCoordinate(LatLng(point.lat, point.lng));
      if (!mounted) return;
      setState(() => _position = Offset(screen.x.toDouble(), screen.y.toDouble()));
    } catch (_) {
      if (mounted) setState(() => _position = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!kIsWeb || _position == null || !widget.replay.isReplayMode) {
      return const SizedBox.shrink();
    }

    final pos = _position!;
    final bearing = widget.replay.currentBearing ?? 0;
    const size = 36.0;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned(
          left: pos.dx - size / 2,
          top: pos.dy - size / 2,
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: _pulse,
              builder: (context, child) {
                final scale = 1.0 + _pulse.value * 0.6;
                return Container(
                  width: size * scale,
                  height: size * scale,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: JourneyScreenTheme.markerCurrent
                        .withValues(alpha: 0.22 * (1 - _pulse.value)),
                  ),
                  child: child,
                );
              },
              child: Transform.rotate(
                // Material navigation icon points 45° clockwise from north at rest.
                angle: (bearing - 45) * math.pi / 180,
                child: Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    color: JourneyScreenTheme.markerCurrent,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x803B82F6),
                        blurRadius: 8,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.navigation_rounded,
                    size: 14,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

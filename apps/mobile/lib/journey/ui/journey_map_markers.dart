import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../journey_models.dart';
import '../journey_replay_controller.dart';

/// Builds route markers while keeping the tracked person's identity separate
/// from start, stop, and end events.
Set<Marker> buildJourneyColoredMarkers(
  JourneyReplayController replay, {
  bool includeCurrentMarker = true,
  BitmapDescriptor? replayAvatarIcon,
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
    final usesAvatar = replayAvatarIcon != null;
    markers.add(
      Marker(
        markerId: const MarkerId('replay'),
        position: LatLng(current.lat, current.lng),
        icon: replayAvatarIcon ??
            BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        rotation: usesAvatar ? 0 : bearing ?? 0,
        flat: !usesAvatar,
        zIndexInt: 3,
        anchor: const Offset(0.5, 0.5),
      ),
    );
  }

  return markers;
}

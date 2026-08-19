import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/location_history_point.dart';
import '../theme/app_theme.dart';
import 'journey_v2_data.dart';

class JourneyV2StaticMap extends StatefulWidget {
  const JourneyV2StaticMap({
    super.key,
    required this.route,
    this.currentIndex = 0,
    this.showReplayPosition = false,
  });

  final JourneyV2Route route;
  final int currentIndex;
  final bool showReplayPosition;

  @override
  State<JourneyV2StaticMap> createState() => _JourneyV2StaticMapState();
}

class _JourneyV2StaticMapState extends State<JourneyV2StaticMap> {
  GoogleMapController? _controller;

  List<LocationHistoryPoint> get _points =>
      journeyV2StaticMapPoints(widget.route);

  @override
  void didUpdateWidget(covariant JourneyV2StaticMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.route.record.id != widget.route.record.id ||
        oldWidget.route.record.polyline != widget.route.record.polyline) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fitRoute());
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _fitRoute() async {
    final controller = _controller;
    final points = _points;
    if (controller == null || points.isEmpty) return;

    if (points.length == 1) {
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(
          LatLng(points.first.lat, points.first.lng),
          16,
        ),
      );
      return;
    }

    final bounds = journeyV2Bounds(points);
    if (bounds == null) return;

    try {
      await controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 44));
    } catch (_) {
      final middle = points[points.length ~/ 2];
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(middle.lat, middle.lng), 14),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final points = _points;

    if (points.length < 2) {
      return DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              GuardianColors.safe.withValues(alpha: 0.06),
              colors.canvas,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.route_outlined,
                  size: 38,
                  color: GuardianColors.safe,
                ),
                const SizedBox(height: 10),
                Text(
                  'Route unavailable',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '${widget.route.record.pointCount} stored route points '
                  'could not be rendered.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final latLngs = [for (final point in points) LatLng(point.lat, point.lng)];
    final continuousSegments = journeyV2StaticMapSegments(widget.route);
    final replayIndex = widget.currentIndex < 0
        ? 0
        : widget.currentIndex >= latLngs.length
        ? latLngs.length - 1
        : widget.currentIndex;
    final replayPoint = latLngs[replayIndex];

    final markers = journeyV2EndpointMarkers(widget.route, points);
    final circles = journeyV2EndpointCircles(widget.route, points);
    final polylines = <Polyline>{};

    if (widget.showReplayPosition && replayIndex < latLngs.length - 1) {
      circles.add(
        Circle(
          circleId: const CircleId('journey-replay-position'),
          center: replayPoint,
          radius: 14,
          fillColor: const Color(0xFF168AAD),
          strokeColor: Colors.white,
          strokeWidth: 3,
          zIndex: 30,
        ),
      );
    }

    for (var gapIndex = 0;
        gapIndex < widget.route.record.routeGaps.length;
        gapIndex++) {
      final gap = widget.route.record.routeGaps[gapIndex];
      final stoppedIndex = gap.fromPointIndex;
      final resumeIndex = gap.toPointIndex;
      if (stoppedIndex != null &&
          stoppedIndex >= 0 &&
          stoppedIndex < latLngs.length &&
          resumeIndex != null &&
          resumeIndex >= 0 &&
          resumeIndex < latLngs.length) {
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-route-unobserved-$gapIndex'),
            points: [latLngs[stoppedIndex], latLngs[resumeIndex]],
            color: const Color(0xFF7C8792).withValues(alpha: 0.78),
            width: 4,
            patterns: [PatternItem.dash(12), PatternItem.gap(8)],
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            zIndex: 1,
          ),
        );
      }
      if (resumeIndex == null ||
          resumeIndex < 0 ||
          resumeIndex >= latLngs.length) {
        continue;
      }
      markers.add(
        Marker(
          markerId: MarkerId('journey-gap-resume-$gapIndex'),
          position: latLngs[resumeIndex],
          zIndexInt: 20,
          infoWindow: InfoWindow(
            title: 'Location reporting resumed',
            snippet: 'After a ${_compactMapDuration(gap.duration)} gap',
          ),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure,
          ),
        ),
      );
    }

    final replayInProgress =
        widget.showReplayPosition && replayIndex < latLngs.length - 1;
    for (var index = 0; index < continuousSegments.length; index++) {
      final segment = continuousSegments[index];
      if (segment.length < 2) continue;
      polylines.add(
        Polyline(
          polylineId: PolylineId('journey-route-full-$index'),
          points: [
            for (final point in segment) LatLng(point.lat, point.lng),
          ],
          color: replayInProgress
              ? GuardianColors.safe.withValues(alpha: 0.24)
              : GuardianColors.safe,
          width: 7,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ),
      );
    }

    if (replayInProgress && replayIndex >= 1) {
      final replaySegments = journeyV2SplitPointsOnTrackingGaps(
        points.sublist(0, replayIndex + 1),
      );
      for (var index = 0; index < replaySegments.length; index++) {
        final segment = replaySegments[index];
        if (segment.length < 2) continue;
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-route-replayed-$index'),
            points: [
              for (final point in segment) LatLng(point.lat, point.lng),
            ],
            color: GuardianColors.safe,
            width: 7,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
          ),
        );
      }
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: GoogleMap(
        initialCameraPosition: CameraPosition(
          target: latLngs[latLngs.length ~/ 2],
          zoom: 13,
        ),
        onMapCreated: (controller) {
          _controller = controller;
          WidgetsBinding.instance.addPostFrameCallback((_) => _fitRoute());
        },
        markers: markers,
        circles: circles,
        polylines: polylines,
        mapType: MapType.normal,
        compassEnabled: false,
        mapToolbarEnabled: false,
        myLocationButtonEnabled: false,
        myLocationEnabled: false,
        zoomControlsEnabled: false,
        rotateGesturesEnabled: false,
        tiltGesturesEnabled: false,
      ),
    );
  }
}

/// A confirmed return-to-origin outing is one round trip. Its anchored first
/// point represents the known origin area, so the map shows one Home marker
/// for both departure and return instead of inventing separate destinations.
Set<Marker> journeyV2EndpointMarkers(
  JourneyV2Route route,
  List<LocationHistoryPoint> points,
) {
  if (points.isEmpty) return <Marker>{};

  if (route.record.hasConfirmedReturn) {
    final originPoint = route.record.routeStartAnchored
        ? points.first
        : points.last;
    final origin = route.record.originGeofenceName?.trim();
    final label = origin == null || origin.isEmpty ? 'Safe zone' : origin;
    return <Marker>{
      Marker(
        markerId: const MarkerId('journey-origin-marker'),
        position: LatLng(originPoint.lat, originPoint.lng),
        zIndexInt: 25,
        infoWindow: InfoWindow(
          title: label,
          snippet: 'Departure and return confirmed',
        ),
        icon: BitmapDescriptor.defaultMarkerWithHue(
          BitmapDescriptor.hueGreen,
        ),
      ),
    };
  }

  final start = LatLng(points.first.lat, points.first.lng);
  final end = LatLng(points.last.lat, points.last.lng);
  final origin = route.record.originGeofenceName?.trim();

  return <Marker>{
    Marker(
      markerId: const MarkerId('journey-start'),
      position: start,
      infoWindow: InfoWindow(
        title: origin == null || origin.isEmpty ? 'Departure' : 'Left $origin',
      ),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
    ),
    Marker(
      markerId: const MarkerId('journey-arrival'),
      position: end,
      infoWindow: const InfoWindow(title: 'Last recorded location'),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
    ),
  };
}

Set<Circle> journeyV2EndpointCircles(
  JourneyV2Route route,
  List<LocationHistoryPoint> points,
) {
  if (!route.record.hasConfirmedReturn || points.isEmpty) return <Circle>{};

  final originPoint = route.record.routeStartAnchored
      ? points.first
      : points.last;
  return <Circle>{
    Circle(
      circleId: const CircleId('journey-origin'),
      center: LatLng(originPoint.lat, originPoint.lng),
      // This is a visibility halo, not the configured geofence boundary.
      radius: 55,
      fillColor: GuardianColors.safe.withValues(alpha: 0.12),
      strokeColor: GuardianColors.safe.withValues(alpha: 0.72),
      strokeWidth: 2,
      zIndex: 10,
    ),
  };
}

bool _basicValid(double lat, double lng) {
  if (!lat.isFinite || !lng.isFinite) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat.abs() < 0.000001 && lng.abs() < 0.000001) return false;
  return true;
}

/// Arithmetic-only Google encoded-polyline decoder.
///
/// It deliberately avoids bitwise signed decoding. The Journey log on Chrome
/// showed the first longitude decoding correctly while the first negative
/// latitude became 42929.511 and later deltas exploded. This is consistent
/// with the signed-delta path behaving differently in the web runtime.
///
/// Keeping this decoder local to the static Journey map lets us prove the
/// route on Chrome without changing the shared Journey decoder or GPS logic.
List<({double lat, double lng})> journeyV2DecodePolylineWebSafe(
  String encoded,
) {
  if (encoded.isEmpty) return const [];

  var index = 0;
  var lat = 0;
  var lng = 0;
  final result = <({double lat, double lng})>[];

  int readDelta() {
    var value = 0;
    var multiplier = 1;

    while (index < encoded.length) {
      final code = encoded.codeUnitAt(index++) - 63;
      if (code < 0) {
        throw const FormatException('Invalid encoded polyline');
      }

      final payload = code % 32;
      value += payload * multiplier;

      if (code < 32) break;
      multiplier *= 32;

      if (multiplier > 1099511627776) {
        throw const FormatException('Encoded polyline component is too long');
      }
    }

    if (value.isOdd) {
      return -((value + 1) ~/ 2);
    }
    return value ~/ 2;
  }

  try {
    while (index < encoded.length) {
      lat += readDelta();
      if (index > encoded.length) break;
      lng += readDelta();

      result.add((lat: lat / 100000.0, lng: lng / 100000.0));
    }
  } on FormatException {
    return const [];
  } on RangeError {
    return const [];
  }

  return List.unmodifiable(result);
}

List<LocationHistoryPoint> _webSafeRecordPoints(JourneyV2Route route) {
  final coords = journeyV2DecodePolylineWebSafe(route.record.polyline);
  if (coords.isEmpty) return const [];

  final startMs = route.record.startAt.millisecondsSinceEpoch;
  final endMs = route.record.endAt.millisecondsSinceEpoch;
  final spanMs = endMs - startMs;
  final hasAlignedEvidence =
      route.record.evidenceVersion >= 2 &&
      route.record.pointEvidence.length == coords.length;

  final points = <LocationHistoryPoint>[
    for (var i = 0; i < coords.length; i++)
      LocationHistoryPoint(
        lat: coords[i].lat,
        lng: coords[i].lng,
        recordedAt: hasAlignedEvidence
            ? DateTime.fromMillisecondsSinceEpoch(
                startMs + route.record.pointEvidence[i].offsetMs,
              )
            : coords.length == 1
            ? route.record.startAt
            : DateTime.fromMillisecondsSinceEpoch(
                startMs + ((spanMs * i) / (coords.length - 1)).round(),
              ),
      ),
  ];

  return points
      .where((point) => _basicValid(point.lat, point.lng))
      .toList(growable: false);
}

List<List<LocationHistoryPoint>> journeyV2SplitPointsOnTrackingGaps(
  List<LocationHistoryPoint> points,
) {
  if (points.isEmpty) return const [];

  final segments = <List<LocationHistoryPoint>>[];
  var current = <LocationHistoryPoint>[points.first];
  for (var index = 1; index < points.length; index++) {
    final previousAt = points[index - 1].recordedAt;
    final pointAt = points[index].recordedAt;
    final trackingInterrupted =
        previousAt == null ||
        pointAt == null ||
        pointAt.difference(previousAt) > const Duration(minutes: 5);
    if (trackingInterrupted) {
      segments.add(List.unmodifiable(current));
      current = <LocationHistoryPoint>[points[index]];
    } else {
      current.add(points[index]);
    }
  }
  segments.add(List.unmodifiable(current));
  return List.unmodifiable(segments);
}

List<List<LocationHistoryPoint>> journeyV2StaticMapSegments(
  JourneyV2Route route,
) {
  return journeyV2SplitPointsOnTrackingGaps(journeyV2StaticMapPoints(route));
}

String _compactMapDuration(Duration duration) {
  if (duration <= Duration.zero) return '0m';
  final minutes = (duration.inSeconds + 59) ~/ 60;
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final remainder = minutes % 60;
  return remainder == 0 ? '${hours}h' : '${hours}h ${remainder}m';
}

/// Static-map point policy:
/// 1. prefer Stage 1 usable points;
/// 2. if those are unavailable, decode the record again with the arithmetic
///    web-safe decoder;
/// 3. only as a final fallback, use already-decoded raw points that are valid.
///
/// No stored data or shared decoding logic is mutated here.
List<LocationHistoryPoint> journeyV2StaticMapPoints(JourneyV2Route route) {
  if (route.usablePoints.length >= 2) {
    return List<LocationHistoryPoint>.unmodifiable(route.usablePoints);
  }

  final webSafe = _webSafeRecordPoints(route);
  if (webSafe.length >= 2) {
    return List<LocationHistoryPoint>.unmodifiable(webSafe);
  }

  final raw = route.rawPoints
      .where((point) => _basicValid(point.lat, point.lng))
      .toList(growable: false);

  return List<LocationHistoryPoint>.unmodifiable(raw);
}

LatLngBounds? journeyV2Bounds(List<LocationHistoryPoint> points) {
  if (points.isEmpty) return null;

  var minLat = points.first.lat;
  var maxLat = points.first.lat;
  var minLng = points.first.lng;
  var maxLng = points.first.lng;

  for (final point in points.skip(1)) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }

  if (minLat == maxLat) {
    minLat -= 0.0005;
    maxLat += 0.0005;
  }
  if (minLng == maxLng) {
    minLng -= 0.0005;
    maxLng += 0.0005;
  }

  return LatLngBounds(
    southwest: LatLng(minLat, minLng),
    northeast: LatLng(maxLat, maxLng),
  );
}

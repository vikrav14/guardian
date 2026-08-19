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
    this.showMapTypeControl = false,
    this.onPointSelected,
  });

  final JourneyV2Route route;
  final int currentIndex;
  final bool showReplayPosition;
  final bool showMapTypeControl;
  final ValueChanged<int>? onPointSelected;

  @override
  State<JourneyV2StaticMap> createState() => _JourneyV2StaticMapState();
}

class _JourneyV2StaticMapState extends State<JourneyV2StaticMap>
    with TickerProviderStateMixin {
  GoogleMapController? _controller;
  late final AnimationController _pulseController;
  late final AnimationController _movementController;
  LatLng? _movementFrom;
  LatLng? _movementTo;
  MapType _mapType = MapType.normal;

  static const _routeColor = Color(0xFF4C5BD4);
  static const _replayColor = Color(0xFFFFA000);

  List<LocationHistoryPoint> get _points =>
      journeyV2StaticMapPoints(widget.route);

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 950),
    )..addListener(_rebuildAnimation);
    _movementController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 680),
    )..addListener(_rebuildAnimation);
    if (widget.showReplayPosition) _startPulse();
  }

  void _rebuildAnimation() {
    if (mounted) setState(() {});
  }

  void _startPulse() {
    if (!_pulseController.isAnimating) {
      _pulseController.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(covariant JourneyV2StaticMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.route.record.id != widget.route.record.id ||
        oldWidget.route.record.polyline != widget.route.record.polyline) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fitRoute());
    }
    if (oldWidget.currentIndex != widget.currentIndex) {
      _animateReplayMovement(oldWidget.currentIndex, widget.currentIndex);
    }
    if (oldWidget.showReplayPosition != widget.showReplayPosition) {
      if (widget.showReplayPosition) {
        _startPulse();
      } else {
        _pulseController.stop();
        _pulseController.value = 0;
      }
    }
  }

  void _animateReplayMovement(int fromIndex, int toIndex) {
    final points = _points;
    if (points.isEmpty ||
        fromIndex < 0 ||
        fromIndex >= points.length ||
        toIndex < 0 ||
        toIndex >= points.length) {
      return;
    }

    final crossesTrackingGap = widget.route.record.routeGaps.any(
      (gap) =>
          gap.fromPointIndex == fromIndex && gap.toPointIndex == toIndex,
    );
    if (crossesTrackingGap) {
      _movementController.stop();
      _movementFrom = null;
      _movementTo = null;
      return;
    }

    _movementFrom = _displayReplayPoint(
      fallback: LatLng(points[fromIndex].lat, points[fromIndex].lng),
    );
    _movementTo = LatLng(points[toIndex].lat, points[toIndex].lng);
    _movementController.forward(from: 0);
  }

  LatLng _displayReplayPoint({required LatLng fallback}) {
    final from = _movementFrom;
    final to = _movementTo;
    if (from == null || to == null || !_movementController.isAnimating) {
      return fallback;
    }
    final progress = Curves.easeInOutCubic.transform(
      _movementController.value,
    );
    return LatLng(
      from.latitude + ((to.latitude - from.latitude) * progress),
      from.longitude + ((to.longitude - from.longitude) * progress),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _movementController.dispose();
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
    final evidenceSegments = journeyV2EvidenceSegments(widget.route);
    final replayIndex = widget.currentIndex < 0
        ? 0
        : widget.currentIndex >= latLngs.length
        ? latLngs.length - 1
        : widget.currentIndex;
    final replayPoint = _displayReplayPoint(fallback: latLngs[replayIndex]);

    final markers = journeyV2EndpointMarkers(widget.route, points);
    final circles = journeyV2EndpointCircles(widget.route, points);
    circles.addAll(journeyV2GapCircles(widget.route, points));
    final polylines = <Polyline>{};

    if (widget.showReplayPosition) {
      final pulse = Curves.easeInOut.transform(_pulseController.value);
      circles.add(
        Circle(
          circleId: const CircleId('journey-replay-pulse'),
          center: replayPoint,
          radius: 24 + (22 * pulse),
          fillColor: _replayColor.withValues(
            alpha: 0.14 - (0.07 * pulse),
          ),
          strokeColor: _replayColor.withValues(
            alpha: 0.78 - (0.34 * pulse),
          ),
          strokeWidth: 2,
          zIndex: 30,
        ),
      );
      circles.add(
        Circle(
          circleId: const CircleId('journey-replay-position'),
          center: replayPoint,
          radius: 11,
          fillColor: _replayColor,
          strokeColor: Colors.white,
          strokeWidth: 4,
          zIndex: 31,
        ),
      );
    }

    if (widget.onPointSelected != null) {
      for (var index = 0; index < latLngs.length; index++) {
        circles.add(
          Circle(
            circleId: CircleId('journey-point-hit-$index'),
            center: latLngs[index],
            radius: 22,
            fillColor: Colors.transparent,
            strokeColor: Colors.transparent,
            strokeWidth: 0,
            consumeTapEvents: true,
            onTap: () => widget.onPointSelected!(index),
            zIndex: 20,
          ),
        );
      }
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
            polylineId: PolylineId('journey-route-unobserved-halo-$gapIndex'),
            points: [latLngs[stoppedIndex], latLngs[resumeIndex]],
            color: Colors.white.withValues(alpha: 0.82),
            width: 7,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            zIndex: 1,
          ),
        );
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-route-unobserved-$gapIndex'),
            points: [latLngs[stoppedIndex], latLngs[resumeIndex]],
            color: const Color(0xFFD98200).withValues(alpha: 0.92),
            width: 3,
            patterns: [PatternItem.dash(10), PatternItem.gap(7)],
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            zIndex: 1,
          ),
        );
      }
    }

    final replayInProgress =
        widget.showReplayPosition && replayIndex < latLngs.length - 1;
    for (var index = 0; index < evidenceSegments.length; index++) {
      final evidenceSegment = evidenceSegments[index];
      final segment = evidenceSegment.points;
      if (segment.length < 2) continue;
      final segmentPoints = [
        for (final point in segment) LatLng(point.lat, point.lng),
      ];
      polylines.add(
        Polyline(
          polylineId: PolylineId('journey-route-halo-$index'),
          points: segmentPoints,
          color: evidenceSegment.approximate
              ? const Color(0xFFFFB020).withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.86),
          width: evidenceSegment.approximate ? 11 : 7,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
          zIndex: 2,
        ),
      );
      polylines.add(
        Polyline(
          polylineId: PolylineId('journey-route-full-$index'),
          points: segmentPoints,
          color: evidenceSegment.approximate
              ? const Color(0xFFD98200).withValues(alpha: 0.72)
              : replayInProgress
              ? _routeColor.withValues(alpha: 0.22)
              : _routeColor.withValues(alpha: 0.92),
          width: evidenceSegment.approximate ? 3 : 4,
          patterns: evidenceSegment.approximate
              ? [PatternItem.dash(8), PatternItem.gap(4)]
              : const <PatternItem>[],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
          zIndex: 3,
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
            color: _routeColor,
            width: 4,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 4,
          ),
        );
      }
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Stack(
        children: [
          Positioned.fill(
            child: GoogleMap(
              initialCameraPosition: CameraPosition(
                target: latLngs[latLngs.length ~/ 2],
                zoom: 13,
              ),
              onMapCreated: (controller) {
                _controller = controller;
                WidgetsBinding.instance.addPostFrameCallback(
                  (_) => _fitRoute(),
                );
                Future<void>.delayed(const Duration(milliseconds: 350), () {
                  if (mounted) _fitRoute();
                });
              },
              markers: markers,
              circles: circles,
              polylines: polylines,
              mapType: _mapType,
              compassEnabled: false,
              mapToolbarEnabled: false,
              myLocationButtonEnabled: false,
              myLocationEnabled: false,
              zoomControlsEnabled: false,
              rotateGesturesEnabled: false,
              tiltGesturesEnabled: false,
            ),
          ),
          if (widget.showMapTypeControl)
            Positioned(
              right: 16,
              top: 72,
              child: Material(
                color: Colors.white.withValues(alpha: 0.96),
                borderRadius: BorderRadius.circular(12),
                elevation: 2,
                child: InkWell(
                  key: const ValueKey('journey-map-type-toggle'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => setState(() {
                    _mapType = _mapType == MapType.normal
                        ? MapType.satellite
                        : MapType.normal;
                  }),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _mapType == MapType.normal
                              ? Icons.satellite_alt_rounded
                              : Icons.map_outlined,
                          size: 17,
                          color: GuardianColors.forest,
                        ),
                        const SizedBox(width: 7),
                        Text(
                          _mapType == MapType.normal ? 'Satellite' : 'Map',
                          style: const TextStyle(
                            color: GuardianColors.forest,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Default Google marker hues are not consistently honoured on web. Confirmed
/// round trips therefore use colored circles below instead of a pin that can
/// incorrectly render red. Non-return journeys retain endpoint pins.
Set<Marker> journeyV2EndpointMarkers(
  JourneyV2Route route,
  List<LocationHistoryPoint> points,
) {
  if (points.isEmpty) return <Marker>{};

  if (route.record.hasConfirmedReturn) return <Marker>{};

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
  final center = LatLng(originPoint.lat, originPoint.lng);
  return <Circle>{
    Circle(
      circleId: const CircleId('journey-origin-halo'),
      center: center,
      // This is a visibility halo, not the configured geofence boundary.
      radius: 55,
      fillColor: GuardianColors.safe.withValues(alpha: 0.12),
      strokeColor: GuardianColors.safe.withValues(alpha: 0.72),
      strokeWidth: 2,
      zIndex: 10,
    ),
    Circle(
      circleId: const CircleId('journey-origin-core'),
      center: center,
      radius: 13,
      fillColor: GuardianColors.safe,
      strokeColor: Colors.white,
      strokeWidth: 3,
      zIndex: 25,
    ),
  };
}

Set<Circle> journeyV2GapCircles(
  JourneyV2Route route,
  List<LocationHistoryPoint> points,
) {
  final circles = <Circle>{};
  for (var index = 0; index < route.record.routeGaps.length; index++) {
    final gap = route.record.routeGaps[index];
    final stoppedIndex = gap.fromPointIndex;
    final resumedIndex = gap.toPointIndex;
    if (stoppedIndex != null &&
        stoppedIndex >= 0 &&
        stoppedIndex < points.length) {
      circles.add(
        Circle(
          circleId: CircleId('journey-gap-stopped-$index'),
          center: LatLng(points[stoppedIndex].lat, points[stoppedIndex].lng),
          radius: 10,
          fillColor: const Color(0xFFD98200),
          strokeColor: Colors.white,
          strokeWidth: 3,
          zIndex: 22,
        ),
      );
    }
    if (resumedIndex != null &&
        resumedIndex >= 0 &&
        resumedIndex < points.length) {
      circles.add(
        Circle(
          circleId: CircleId('journey-gap-resumed-$index'),
          center: LatLng(points[resumedIndex].lat, points[resumedIndex].lng),
          radius: 12,
          fillColor: const Color(0xFFFFB020),
          strokeColor: Colors.white,
          strokeWidth: 3,
          zIndex: 23,
        ),
      );
    }
  }
  return circles;
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

typedef JourneyV2EvidenceSegment = ({
  bool approximate,
  List<LocationHistoryPoint> points,
});

List<JourneyV2EvidenceSegment> journeyV2EvidenceSegments(
  JourneyV2Route route,
) {
  final output = <JourneyV2EvidenceSegment>[];
  for (final continuous in journeyV2StaticMapSegments(route)) {
    if (continuous.length < 2) continue;
    var approximate = _journeyV2ApproximateEdge(continuous[0], continuous[1]);
    var current = <LocationHistoryPoint>[continuous[0], continuous[1]];

    for (var index = 2; index < continuous.length; index++) {
      final nextApproximate = _journeyV2ApproximateEdge(
        continuous[index - 1],
        continuous[index],
      );
      if (nextApproximate == approximate) {
        current.add(continuous[index]);
        continue;
      }
      output.add((approximate: approximate, points: List.unmodifiable(current)));
      approximate = nextApproximate;
      current = <LocationHistoryPoint>[
        continuous[index - 1],
        continuous[index],
      ];
    }
    output.add((approximate: approximate, points: List.unmodifiable(current)));
  }
  return List.unmodifiable(output);
}

bool _journeyV2ApproximateEdge(
  LocationHistoryPoint from,
  LocationHistoryPoint to,
) {
  bool approximate(LocationHistoryPoint point) {
    final source = (point.source ?? point.accuracySource ?? '').toLowerCase();
    return source == 'wifi' || source == 'lbs';
  }

  return approximate(from) || approximate(to);
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

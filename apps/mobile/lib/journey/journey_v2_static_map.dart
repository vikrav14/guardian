import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../theme/app_theme.dart';
import '../safe_zones/safe_zone_logic.dart' show haversineMeters;
import 'journey_replay_overlay.dart';
import 'journey_endpoint_icons.dart';
import 'journey_v2_data.dart';

class JourneyV2StaticMapController {
  Future<void> Function()? _fitCompleteRoute;

  Future<void> fitCompleteRoute() async {
    await _fitCompleteRoute?.call();
  }

  void _attach(Future<void> Function() fitCompleteRoute) {
    _fitCompleteRoute = fitCompleteRoute;
  }

  void _detach(Future<void> Function() fitCompleteRoute) {
    if (_fitCompleteRoute == fitCompleteRoute) {
      _fitCompleteRoute = null;
    }
  }
}

class JourneyV2StaticMap extends StatefulWidget {
  const JourneyV2StaticMap({
    super.key,
    required this.route,
    this.deviceName = 'Wearer',
    this.deviceImei = '',
    this.avatarUrl,
    this.currentIndex = 0,
    this.showReplayPosition = false,
    this.showMapTypeControl = false,
    this.showSourceEvidence = false,
    this.originGeofence,
    this.controller,
    this.onPointSelected,
    this.mapPadding = EdgeInsets.zero,
  });

  final JourneyV2Route route;
  final String deviceName;
  final String deviceImei;
  final String? avatarUrl;
  final int currentIndex;
  final bool showReplayPosition;
  final bool showMapTypeControl;
  final bool showSourceEvidence;
  final Geofence? originGeofence;
  final JourneyV2StaticMapController? controller;
  final ValueChanged<int>? onPointSelected;
  final EdgeInsets mapPadding;

  @override
  State<JourneyV2StaticMap> createState() => _JourneyV2StaticMapState();
}

class _JourneyV2StaticMapState extends State<JourneyV2StaticMap> {
  GoogleMapController? _controller;
  final ValueNotifier<int> _cameraGeneration = ValueNotifier<int>(0);
  bool _animateReplay = false;
  bool _fitting = false;
  bool _fitPending = false;
  late List<LocationHistoryPoint> _points;
  MapType _mapType = MapType.normal;
  ({BitmapDescriptor start, BitmapDescriptor end})? _endpointIcons;
  Object? _endpointStyle;
  int _iconGeneration = 0;

  static const _routeColor = Color(0xFF4F5CCB);
  static const _gpsEvidenceColor = Color(0xFF2563EB);
  static const _googleEvidenceColor = Color(0xFF7C3AED);

  @override
  void initState() {
    super.initState();
    _points = journeyV2StaticMapPoints(widget.route);
    widget.controller?._attach(_fitRoute);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _prepareEndpointIcons();
  }

  void _prepareEndpointIcons() {
    final colors = context.guardianColors;
    final journey = widget.route.record;
    final style = (
      journeyV2DepartureCaption(widget.route),
      journeyV2ArrivalCaption(widget.route),
      journey.routeStartAnchored
          ? journey.confirmedDepartureAt
          : (_points.isEmpty
                ? journey.startAt
                : _points.first.recordedAt ?? journey.startAt),
      journey.confirmedReturnAt,
      colors.surface,
      colors.textSecondary,
      MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0),
    );
    if (style == _endpointStyle) return;
    _endpointStyle = style;
    _endpointIcons = null;
    final generation = ++_iconGeneration;
    unawaited(() async {
      try {
        final start = await journeyEndpointIcon(
          caption: style.$1,
          time: DateFormat.Hm().format(style.$3),
          departure: true,
          surface: style.$5,
          foreground: style.$6,
          pixelRatio: style.$7,
        );
        final end = await journeyEndpointIcon(
          caption: style.$2,
          time: DateFormat.Hm().format(style.$4),
          departure: false,
          surface: style.$5,
          foreground: style.$6,
          pixelRatio: style.$7,
        );
        if (!mounted || generation != _iconGeneration) return;
        setState(() => _endpointIcons = (start: start, end: end));
      } catch (_) {
        // Endpoint captions remain available in Journey details if rendering
        // fails. Never fall back to the misleading red/green default pins.
      }
    }());
  }

  @override
  void didUpdateWidget(covariant JourneyV2StaticMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller?._detach(_fitRoute);
      widget.controller?._attach(_fitRoute);
    }
    final routeChanged =
        oldWidget.route.record.id != widget.route.record.id ||
        oldWidget.route.record.polyline != widget.route.record.polyline ||
        oldWidget.route.presentation?.generatedAt !=
            widget.route.presentation?.generatedAt;
    if (oldWidget.route != widget.route) {
      _points = journeyV2StaticMapPoints(widget.route);
      _prepareEndpointIcons();
    }
    if (routeChanged) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_fitRoute());
      });
    }
    // Do not interpolate across a tracking gap or when selecting another trip.
    _animateReplay =
        !routeChanged &&
        (widget.route.hasPresentation ||
            !widget.route.record.routeGaps.any(
              (gap) =>
                  gap.fromPointIndex == oldWidget.currentIndex &&
                  gap.toPointIndex == widget.currentIndex,
            ));
  }

  @override
  void dispose() {
    widget.controller?._detach(_fitRoute);
    _cameraGeneration.dispose();
    // GoogleMap owns and disposes its controller exactly once.
    _controller = null;
    super.dispose();
  }

  Future<void> _fitRoute() async {
    _fitPending = true;
    if (_fitting || !mounted) return;
    _fitting = true;
    try {
      while (mounted && _fitPending) {
        _fitPending = false;
        final controller = _controller;
        final bounds = journeyV2Bounds(_points);
        if (controller == null || bounds == null) return;
        try {
          await controller.animateCamera(
            CameraUpdate.newLatLngBounds(bounds, 44),
          );
        } catch (_) {
          // Navigation may have disposed the map while the fit was pending.
        }
      }
    } finally {
      _fitting = false;
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
    final presentationSegments = journeyV2PresentationMapSegments(widget.route);
    final hasPresentation = presentationSegments.isNotEmpty;
    final evidenceSegments = journeyV2EvidenceSegments(widget.route);
    final replayIndex = widget.currentIndex < 0
        ? 0
        : widget.currentIndex >= latLngs.length
        ? latLngs.length - 1
        : widget.currentIndex;
    final replayPoint = latLngs[replayIndex];

    final markers = journeyV2EndpointMarkers(
      widget.route,
      points,
      startIcon: _endpointIcons?.start,
      endIcon: _endpointIcons?.end,
    );
    final circles = journeyV2EndpointCircles(
      widget.route,
      points,
      originGeofence: widget.originGeofence,
    );
    if (widget.showSourceEvidence) {
      circles.addAll(journeyV2SourceEvidenceCircles(widget.route));
    }
    if (!hasPresentation) {
      circles.addAll(journeyV2GapCircles(widget.route, points));
    }
    final polylines = <Polyline>{};

    for (
      var gapIndex = 0;
      !hasPresentation && gapIndex < widget.route.record.routeGaps.length;
      gapIndex++
    ) {
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
    if (hasPresentation) {
      for (var index = 0; index < presentationSegments.length; index++) {
        final segment = presentationSegments[index];
        if (segment.points.length < 2) continue;
        final segmentPoints = [
          for (final point in segment.points) LatLng(point.lat, point.lng),
        ];
        final sourceColor = segment.source == 'google'
            ? _googleEvidenceColor
            : _gpsEvidenceColor;
        final color = widget.showSourceEvidence ? sourceColor : _routeColor;
        final isGpsBridge = segment.source == 'gps_bridge';
        final revealGpsBridge = widget.showSourceEvidence && isGpsBridge;
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-presentation-glow-$index'),
            points: segmentPoints,
            color: color.withValues(alpha: 0.14),
            width: 11,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 1,
          ),
        );
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-presentation-casing-$index'),
            points: segmentPoints,
            color: Colors.white.withValues(alpha: 0.88),
            width: 7,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 2,
          ),
        );
        polylines.add(
          Polyline(
            polylineId: PolylineId(
              'journey-presentation-${segment.source}-$index',
            ),
            points: segmentPoints,
            color: color.withValues(alpha: revealGpsBridge ? 0.74 : 0.96),
            width: 3,
            patterns: revealGpsBridge
                ? [PatternItem.dash(9), PatternItem.gap(6)]
                : const <PatternItem>[],
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 3,
          ),
        );
      }
    } else {
      for (var index = 0; index < evidenceSegments.length; index++) {
        final evidenceSegment = evidenceSegments[index];
        final segment = evidenceSegment.points;
        if (segment.length < 2) continue;
        final revealApproximate =
            widget.showSourceEvidence && evidenceSegment.approximate;
        final segmentPoints = [
          for (final point in segment) LatLng(point.lat, point.lng),
        ];
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-route-halo-$index'),
            points: segmentPoints,
            color: revealApproximate
                ? const Color(0xFFFFB020).withValues(alpha: 0.18)
                : Colors.white.withValues(alpha: 0.86),
            width: revealApproximate ? 11 : 7,
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
            color: revealApproximate
                ? const Color(0xFFD98200).withValues(alpha: 0.72)
                : replayInProgress
                ? _routeColor.withValues(alpha: 0.22)
                : _routeColor.withValues(alpha: 0.92),
            width: revealApproximate ? 3 : 4,
            patterns: revealApproximate
                ? [PatternItem.dash(8), PatternItem.gap(4)]
                : const <PatternItem>[],
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 3,
          ),
        );
      }
    }

    if (!hasPresentation && replayInProgress && replayIndex >= 1) {
      final replaySegments = journeyV2SplitPointsOnTrackingGaps(
        points.sublist(0, replayIndex + 1),
      );
      for (var index = 0; index < replaySegments.length; index++) {
        final segment = replaySegments[index];
        if (segment.length < 2) continue;
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-route-replayed-$index'),
            points: [for (final point in segment) LatLng(point.lat, point.lng)],
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
                if (!mounted) return;
                _controller = controller;
                _cameraGeneration.value++;
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) unawaited(_fitRoute());
                });
              },
              markers: markers,
              circles: circles,
              polylines: polylines,
              mapType: _mapType,
              padding: widget.mapPadding,
              style:
                  '[{"featureType":"poi","stylers":[{"visibility":"off"}]},{"featureType":"transit","stylers":[{"visibility":"off"}]}]',
              compassEnabled: false,
              mapToolbarEnabled: false,
              myLocationButtonEnabled: false,
              myLocationEnabled: false,
              zoomControlsEnabled: false,
              rotateGesturesEnabled: false,
              tiltGesturesEnabled: false,
              gestureRecognizers: {
                Factory<EagerGestureRecognizer>(EagerGestureRecognizer.new),
              },
              onTap: widget.onPointSelected == null
                  ? null
                  : (position) {
                      final index = journeyV2NearestPointIndex(
                        points,
                        position,
                      );
                      if (index != null) widget.onPointSelected?.call(index);
                    },
              onCameraMove: (_) {
                if (mounted) _cameraGeneration.value++;
              },
              onCameraIdle: () {
                if (mounted) _cameraGeneration.value++;
              },
            ),
          ),
          if (widget.showReplayPosition)
            Positioned.fill(
              child: ValueListenableBuilder<int>(
                valueListenable: _cameraGeneration,
                builder: (context, generation, _) {
                  return JourneyReplayOverlay(
                    controller: _controller,
                    position: replayPoint,
                    animatePosition: _animateReplay,
                    cameraGeneration: generation,
                    deviceName: widget.deviceName,
                    identityKey: widget.deviceImei.trim().isEmpty
                        ? widget.deviceName
                        : widget.deviceImei,
                    avatarUrl: widget.avatarUrl,
                    recordedAt:
                        replayIndex == 0 &&
                            widget.route.record.routeStartAnchored
                        ? widget.route.record.confirmedDepartureAt
                        : points[replayIndex].recordedAt,
                  );
                },
              ),
            ),
          if (widget.showMapTypeControl)
            Positioned(
              right: 16,
              top: 72,
              child: Material(
                color: colors.surface,
                borderRadius: BorderRadius.circular(12),
                elevation: 2,
                child: IconButton(
                  key: const ValueKey('journey-map-type-toggle'),
                  tooltip: _mapType == MapType.normal ? 'Satellite' : 'Map',
                  onPressed: () => setState(() {
                    _mapType = _mapType == MapType.normal
                        ? MapType.satellite
                        : MapType.normal;
                  }),
                  icon: Icon(
                    _mapType == MapType.normal
                        ? Icons.satellite_alt_rounded
                        : Icons.map_outlined,
                    size: 22,
                    color: colors.textPrimary,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Hit-test the route without allocating a native circle for every point.
/// Keep the original 22 metre hit radius and replay indexes, including the
/// provider-derived display points when a presentation is available.
int? journeyV2NearestPointIndex(
  List<LocationHistoryPoint> points,
  LatLng position, {
  double radiusMeters = 22,
}) {
  int? nearest;
  var distance = radiusMeters;
  for (var index = 0; index < points.length; index++) {
    final point = points[index];
    final candidate = haversineMeters(
      position.latitude,
      position.longitude,
      point.lat,
      point.lng,
    );
    if (candidate <= distance) {
      nearest = index;
      distance = candidate;
    }
  }
  return nearest;
}

/// Google map circles are measured in metres. Scale the replay halo with the
/// journey extent so it keeps roughly the same visual weight when a long trip
/// forces the camera much farther out than a short local outing.
double journeyV2ReplayHaloRadius(List<LocationHistoryPoint> points) {
  if (points.length < 2) return 24;

  var minLat = points.first.lat;
  var maxLat = points.first.lat;
  var minLng = points.first.lng;
  var maxLng = points.first.lng;
  for (final point in points.skip(1)) {
    minLat = math.min(minLat, point.lat);
    maxLat = math.max(maxLat, point.lat);
    minLng = math.min(minLng, point.lng);
    maxLng = math.max(maxLng, point.lng);
  }

  const metresPerLatitudeDegree = 111320.0;
  final middleLatitudeRadians = ((minLat + maxLat) / 2) * math.pi / 180;
  final latitudeMetres = (maxLat - minLat) * metresPerLatitudeDegree;
  final longitudeMetres =
      (maxLng - minLng) *
      metresPerLatitudeDegree *
      math.cos(middleLatitudeRadians).abs();
  final diagonalMetres = math.sqrt(
    (latitudeMetres * latitudeMetres) + (longitudeMetres * longitudeMetres),
  );

  return (diagonalMetres * 0.0045).clamp(24.0, 260.0).toDouble();
}

String journeyV2DepartureCaption(JourneyV2Route route) {
  final origin = route.record.originGeofenceName?.trim();
  return route.record.routeStartAnchored && origin != null && origin.isNotEmpty
      ? 'Left $origin'
      : 'First recorded';
}

String journeyV2ArrivalCaption(JourneyV2Route route) =>
    route.record.hasConfirmedReturn
    ? 'Returned ${route.record.originGeofenceName!.trim()}'
    : 'Last recorded';

/// Custom neutral labels only: never show default red/green endpoint pins.
Set<Marker> journeyV2EndpointMarkers(
  JourneyV2Route route,
  List<LocationHistoryPoint> points, {
  BitmapDescriptor? startIcon,
  BitmapDescriptor? endIcon,
}) {
  if (points.isEmpty || startIcon == null || endIcon == null) return <Marker>{};

  final start = LatLng(points.first.lat, points.first.lng);
  final end = LatLng(points.last.lat, points.last.lng);

  return <Marker>{
    Marker(
      markerId: const MarkerId('journey-start'),
      position: start,
      infoWindow: InfoWindow(title: journeyV2DepartureCaption(route)),
      icon: startIcon,
      anchor: const Offset(0.5, 53 / 58),
    ),
    Marker(
      markerId: const MarkerId('journey-arrival'),
      position: end,
      infoWindow: InfoWindow(title: journeyV2ArrivalCaption(route)),
      icon: endIcon,
      anchor: const Offset(0.5, 5 / 58),
    ),
  };
}

Set<Circle> journeyV2EndpointCircles(
  JourneyV2Route route,
  List<LocationHistoryPoint> points, {
  Geofence? originGeofence,
}) {
  if (!route.record.hasConfirmedReturn || points.isEmpty) return <Circle>{};

  final configuredZone = originGeofence;
  final hasConfiguredSafeZone =
      configuredZone != null &&
      configuredZone.active &&
      _basicValid(configuredZone.lat, configuredZone.lng) &&
      configuredZone.radiusMeters > 0;
  final fallbackPoint = route.record.routeStartAnchored
      ? points.first
      : points.last;
  final center = hasConfiguredSafeZone
      ? LatLng(configuredZone.lat, configuredZone.lng)
      : LatLng(fallbackPoint.lat, fallbackPoint.lng);
  final circles = <Circle>{};
  if (hasConfiguredSafeZone) {
    circles.add(
      Circle(
        circleId: const CircleId('journey-origin-safe-zone'),
        center: center,
        radius: configuredZone.radiusMeters,
        fillColor: GuardianColors.safe.withValues(alpha: 0.10),
        strokeColor: GuardianColors.safe.withValues(alpha: 0.72),
        strokeWidth: 2,
        zIndex: 10,
      ),
    );
  }
  circles.add(
    Circle(
      circleId: const CircleId('journey-origin-core'),
      center: center,
      radius: 13,
      fillColor: const Color(0xFF596B72),
      strokeColor: Colors.white,
      strokeWidth: 3,
      zIndex: 25,
    ),
  );
  return circles;
}

Set<Circle> journeyV2SourceEvidenceCircles(JourneyV2Route route) {
  final rawPoints = journeyV2RecordedGpsEvidencePoints(route);
  if (rawPoints.isEmpty) return <Circle>{};

  // Evidence must remain visible when Fit complete route zooms out over a
  // long outing. The old 6-22 m dots were effectively sub-pixel on Trip 2.
  final evidenceRadius = (journeyV2ReplayHaloRadius(rawPoints) * 0.80)
      .clamp(34.0, 140.0)
      .toDouble();
  final circles = <Circle>{};
  for (var index = 0; index < rawPoints.length; index++) {
    final point = rawPoints[index];
    const color = _JourneyV2StaticMapState._gpsEvidenceColor;
    circles.add(
      Circle(
        circleId: CircleId('journey-source-evidence-$index'),
        center: LatLng(point.lat, point.lng),
        radius: evidenceRadius,
        fillColor: color.withValues(alpha: 0.88),
        strokeColor: Colors.white,
        strokeWidth: 3,
        zIndex: 19,
      ),
    );
  }
  return circles;
}

List<LocationHistoryPoint> journeyV2RecordedGpsEvidencePoints(
  JourneyV2Route route,
) {
  List<LocationHistoryPoint> validGpsPoints(
    Iterable<LocationHistoryPoint> points,
  ) {
    return points
        .where((point) {
          if (!_basicValid(point.lat, point.lng)) return false;
          final source = (point.source ?? point.accuracySource ?? '')
              .toLowerCase();
          return point.gpsValid == true || source == 'gps';
        })
        .toList(growable: false);
  }

  final usableEvidence = validGpsPoints(route.usablePoints);
  if (usableEvidence.isNotEmpty) return List.unmodifiable(usableEvidence);

  final rawEvidence = validGpsPoints(route.rawPoints);
  if (rawEvidence.isNotEmpty) return List.unmodifiable(rawEvidence);

  // Chrome can leave rawPoints non-empty even when signed polyline decoding
  // produced invalid coordinates. Do not let that block the arithmetic-only
  // decoder used by the Journey map and its evidence counter.
  return List.unmodifiable(validGpsPoints(_webSafeRecordPoints(route)));
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
        speedKmh: hasAlignedEvidence
            ? route.record.pointEvidence[i].speedKmh
            : null,
        accuracySource: hasAlignedEvidence
            ? route.record.pointEvidence[i].source
            : null,
        source: hasAlignedEvidence
            ? route.record.pointEvidence[i].source
            : null,
        gpsValid: hasAlignedEvidence
            ? route.record.pointEvidence[i].gpsValid
            : null,
        accuracyMeters: hasAlignedEvidence
            ? route.record.pointEvidence[i].accuracyMeters
            : null,
        satellites: hasAlignedEvidence
            ? route.record.pointEvidence[i].satellites
            : null,
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

List<JourneyV2EvidenceSegment> journeyV2EvidenceSegments(JourneyV2Route route) {
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
      output.add((
        approximate: approximate,
        points: List.unmodifiable(current),
      ));
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
  final presentationPoints = _webSafePresentationPoints(route);
  if (presentationPoints.length >= 2) {
    return List<LocationHistoryPoint>.unmodifiable(presentationPoints);
  }

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

typedef JourneyV2PresentationMapSegment = ({
  String source,
  List<LocationHistoryPoint> points,
});

List<JourneyV2PresentationMapSegment> journeyV2PresentationMapSegments(
  JourneyV2Route route,
) {
  final presentation = route.presentation;
  if (presentation == null) return const [];
  final output = <JourneyV2PresentationMapSegment>[];
  for (final segment in presentation.segments) {
    final coordinates = journeyV2DecodePolylineWebSafe(segment.polyline);
    final points =
        [
              for (final coordinate in coordinates)
                LocationHistoryPoint(
                  lat: coordinate.lat,
                  lng: coordinate.lng,
                  source: segment.source,
                  gpsValid: segment.source == 'gps',
                ),
            ]
            .where((point) => _basicValid(point.lat, point.lng))
            .toList(growable: false);
    if (points.length >= 2) {
      output.add((source: segment.source, points: List.unmodifiable(points)));
    }
  }
  return List.unmodifiable(output);
}

List<LocationHistoryPoint> _webSafePresentationPoints(
  JourneyV2Route route, {
  int maxPointsPerSegment = 24,
}) {
  final presentation = route.presentation;
  if (presentation == null) return const [];
  final output = <LocationHistoryPoint>[];
  for (final segment in presentation.segments) {
    final coordinates = journeyV2DecodePolylineWebSafe(segment.polyline);
    if (coordinates.length < 2) continue;
    final step = coordinates.length <= maxPointsPerSegment
        ? 1
        : ((coordinates.length - 1) / (maxPointsPerSegment - 1)).ceil();
    final indexes = <int>[
      for (var index = 0; index < coordinates.length; index += step) index,
      if ((coordinates.length - 1) % step != 0) coordinates.length - 1,
    ];
    for (final coordinateIndex in indexes) {
      final coordinate = coordinates[coordinateIndex];
      final ratio = coordinateIndex / (coordinates.length - 1);
      final offsetMs =
          segment.fromOffsetMs +
          ((segment.toOffsetMs - segment.fromOffsetMs) * ratio).round();
      final sourcePointIndex =
          segment.fromPointIndex +
          ((segment.toPointIndex - segment.fromPointIndex) * ratio).round();
      final point = LocationHistoryPoint(
        lat: coordinate.lat,
        lng: coordinate.lng,
        source: segment.source,
        accuracySource: segment.source,
        gpsValid: segment.source == 'gps',
        recordedAt: route.record.startAt.add(Duration(milliseconds: offsetMs)),
        sourcePointIndex: sourcePointIndex,
      );
      if (!_basicValid(point.lat, point.lng)) continue;
      final previous = output.isEmpty ? null : output.last;
      final duplicate =
          previous != null &&
          (previous.lat - point.lat).abs() < 0.0000001 &&
          (previous.lng - point.lng).abs() < 0.0000001 &&
          previous.recordedAt == point.recordedAt;
      if (!duplicate) output.add(point);
    }
  }
  return List.unmodifiable(output);
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

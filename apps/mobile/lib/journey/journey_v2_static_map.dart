import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../theme/app_theme.dart';
import '../widgets/map/map_avatar_overlay.dart';
import '../widgets/map/person_map_marker.dart';
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

  @override
  State<JourneyV2StaticMap> createState() => _JourneyV2StaticMapState();
}

class _JourneyV2StaticMapState extends State<JourneyV2StaticMap>
    with TickerProviderStateMixin {
  GoogleMapController? _controller;
  final ValueNotifier<int> _cameraGeneration = ValueNotifier<int>(0);
  BitmapDescriptor? _replayAvatarIcon;
  late final AnimationController _pulseController;
  late final AnimationController _movementController;
  LatLng? _movementFrom;
  LatLng? _movementTo;
  MapType _mapType = MapType.normal;

  static const _routeColor = Color(0xFF4F46E5);
  static const _gpsEvidenceColor = Color(0xFF2563EB);
  static const _googleEvidenceColor = Color(0xFF7C3AED);
  static const _directionColor = Color(0xFF312E81);
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
    if (widget.showReplayPosition) {
      _startPulse();
      unawaited(_loadReplayAvatarIcon());
    }
    widget.controller?._attach(_fitRoute);
  }

  void _rebuildAnimation() {
    if (mounted) setState(() {});
  }

  void _startPulse() {
    if (!_pulseController.isAnimating) {
      _pulseController.repeat(reverse: true);
    }
  }

  Future<void> _loadReplayAvatarIcon() async {
    if (kIsWeb || !widget.showReplayPosition) return;

    final name = widget.deviceName.trim().isEmpty
        ? 'Wearer'
        : widget.deviceName.trim();
    final identityKey = widget.deviceImei.trim().isEmpty
        ? name
        : widget.deviceImei.trim();

    try {
      final icon = await PersonMapMarker.create(
        initials: initialsFor(name),
        color: avatarColorForKey(identityKey),
        selected: false,
        surfaceColor: Colors.white,
        imageUrl: widget.avatarUrl,
      );
      if (!mounted) return;
      setState(() => _replayAvatarIcon = icon);
    } catch (_) {
      // The orange replay core remains a reliable fallback if avatar rendering
      // is unavailable on a platform or the image cannot be loaded.
    }
  }

  @override
  void didUpdateWidget(covariant JourneyV2StaticMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller?._detach(_fitRoute);
      widget.controller?._attach(_fitRoute);
    }
    if (oldWidget.route.record.id != widget.route.record.id ||
        oldWidget.route.record.polyline != widget.route.record.polyline ||
        oldWidget.route.presentation?.generatedAt !=
            widget.route.presentation?.generatedAt) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fitRoute());
    }
    if (oldWidget.currentIndex != widget.currentIndex) {
      _animateReplayMovement(oldWidget.currentIndex, widget.currentIndex);
    }
    final avatarChanged =
        oldWidget.deviceName != widget.deviceName ||
        oldWidget.deviceImei != widget.deviceImei ||
        oldWidget.avatarUrl != widget.avatarUrl;
    if (oldWidget.showReplayPosition != widget.showReplayPosition) {
      if (widget.showReplayPosition) {
        _startPulse();
        unawaited(_loadReplayAvatarIcon());
      } else {
        _pulseController.stop();
        _pulseController.value = 0;
        _replayAvatarIcon = null;
      }
    } else if (widget.showReplayPosition && avatarChanged) {
      _replayAvatarIcon = null;
      unawaited(_loadReplayAvatarIcon());
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

    final crossesTrackingGap = !widget.route.hasPresentation &&
        widget.route.record.routeGaps.any(
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
    widget.controller?._detach(_fitRoute);
    _pulseController.dispose();
    _movementController.dispose();
    _cameraGeneration.dispose();
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
    final presentationSegments = journeyV2PresentationMapSegments(widget.route);
    final hasPresentation = presentationSegments.isNotEmpty;
    final evidenceSegments = journeyV2EvidenceSegments(widget.route);
    final directionSegments = hasPresentation
        ? [for (final segment in presentationSegments) segment.points]
        : [for (final segment in evidenceSegments) segment.points];
    final replayIndex = widget.currentIndex < 0
        ? 0
        : widget.currentIndex >= latLngs.length
        ? latLngs.length - 1
        : widget.currentIndex;
    final replayPoint = _displayReplayPoint(fallback: latLngs[replayIndex]);
    final replayBaseRadius = journeyV2ReplayHaloRadius(points);
    final replayCoreRadius = (replayBaseRadius * 0.38)
        .clamp(11.0, 55.0)
        .toDouble();

    final markers = journeyV2EndpointMarkers(widget.route, points);
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

    final replayAvatarIcon = _replayAvatarIcon;
    if (widget.showReplayPosition &&
        !kIsWeb &&
        replayAvatarIcon != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('journey-replay-avatar'),
          position: replayPoint,
          icon: replayAvatarIcon,
          anchor: const Offset(0.5, 0.5),
          zIndexInt: 40,
        ),
      );
    }

    if (widget.showReplayPosition) {
      final pulse = Curves.easeInOut.transform(_pulseController.value);
      circles.add(
        Circle(
          circleId: const CircleId('journey-replay-pulse'),
          center: replayPoint,
          radius: replayBaseRadius * (1 + (0.9 * pulse)),
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
          radius: replayCoreRadius,
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
        !hasPresentation && gapIndex < widget.route.record.routeGaps.length;
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
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-presentation-casing-$index'),
            points: segmentPoints,
            color: Colors.white.withValues(alpha: isGpsBridge ? 0.78 : 0.90),
            width: isGpsBridge ? 6 : 8,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 2,
          ),
        );
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-presentation-${segment.source}-$index'),
            points: segmentPoints,
            color: color.withValues(alpha: isGpsBridge ? 0.72 : 0.94),
            width: isGpsBridge ? 3 : 4,
            patterns: isGpsBridge
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

    if (widget.showMapTypeControl) {
      final chevrons = journeyV2DirectionChevrons(directionSegments);
      for (var index = 0; index < chevrons.length; index++) {
        final chevron = chevrons[index];
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-direction-casing-$index'),
            points: chevron,
            color: Colors.white.withValues(alpha: 0.96),
            width: 5,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 6,
          ),
        );
        polylines.add(
          Polyline(
            polylineId: PolylineId('journey-direction-$index'),
            points: chevron,
            color: _directionColor,
            width: 2,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            jointType: JointType.round,
            zIndex: 7,
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
                _cameraGeneration.value++;
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
              onCameraMove: (_) {
                if (kIsWeb) _cameraGeneration.value++;
              },
              onCameraIdle: () {
                if (kIsWeb) _cameraGeneration.value++;
              },
            ),
          ),
          if (kIsWeb && widget.showReplayPosition)
            Positioned.fill(
              child: ValueListenableBuilder<int>(
                valueListenable: _cameraGeneration,
                builder: (context, generation, _) {
                  return JourneyMapAvatarOverlay(
                    controller: _controller,
                    slots: [
                      JourneyMapAvatarSlot(
                        id: 'journey-replay-avatar',
                        latLng: replayPoint,
                        selected: false,
                      ),
                    ],
                    cameraGeneration: generation,
                    deviceName: widget.deviceName,
                    imei: widget.deviceImei.trim().isEmpty
                        ? widget.deviceName
                        : widget.deviceImei,
                    avatarUrl: widget.avatarUrl,
                  );
                },
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
    (latitudeMetres * latitudeMetres) +
        (longitudeMetres * longitudeMetres),
  );

  return (diagonalMetres * 0.0045).clamp(24.0, 260.0).toDouble();
}

class _JourneyV2DirectionLeg {
  const _JourneyV2DirectionLeg({
    required this.from,
    required this.to,
    required this.distanceMetres,
  });

  final LocationHistoryPoint from;
  final LocationHistoryPoint to;
  final double distanceMetres;
}

/// Builds a small number of open chevrons that follow recorded travel order.
///
/// Each chevron sits just to the traveller's right. A return along the same
/// road therefore lands on the opposite side instead of drawing another thick
/// line directly over the outbound pass.
List<List<LatLng>> journeyV2DirectionChevrons(
  Iterable<List<LocationHistoryPoint>> segments, {
  int maxCount = 9,
}) {
  if (maxCount <= 0) return const [];

  const metresPerLatitudeDegree = 111320.0;
  final legs = <_JourneyV2DirectionLeg>[];
  var totalMetres = 0.0;
  for (final segment in segments) {
    for (var index = 1; index < segment.length; index++) {
      final from = segment[index - 1];
      final to = segment[index];
      if (!_basicValid(from.lat, from.lng) || !_basicValid(to.lat, to.lng)) {
        continue;
      }
      final middleLatitudeRadians =
          ((from.lat + to.lat) / 2) * math.pi / 180;
      final northMetres = (to.lat - from.lat) * metresPerLatitudeDegree;
      final eastMetres =
          (to.lng - from.lng) *
          metresPerLatitudeDegree *
          math.cos(middleLatitudeRadians).abs();
      final distanceMetres = math.sqrt(
        (northMetres * northMetres) + (eastMetres * eastMetres),
      );
      if (!distanceMetres.isFinite || distanceMetres < 2) continue;
      legs.add(
        _JourneyV2DirectionLeg(
          from: from,
          to: to,
          distanceMetres: distanceMetres,
        ),
      );
      totalMetres += distanceMetres;
    }
  }
  if (legs.isEmpty || totalMetres < 120) return const [];

  final desiredCount = (totalMetres / 1800).round().clamp(2, maxCount).toInt();
  final spacingMetres = totalMetres / (desiredCount + 1);
  final arrowLengthMetres = (totalMetres * 0.0025)
      .clamp(24.0, 72.0)
      .toDouble();
  final laneOffsetMetres = arrowLengthMetres * 0.58;
  final wingHalfWidthMetres = arrowLengthMetres * 0.34;
  final chevrons = <List<LatLng>>[];
  var traversedMetres = 0.0;
  var targetMetres = spacingMetres;

  for (final leg in legs) {
    while (targetMetres <= traversedMetres + leg.distanceMetres &&
        chevrons.length < desiredCount) {
      final ratio = ((targetMetres - traversedMetres) / leg.distanceMetres)
          .clamp(0.0, 1.0)
          .toDouble();
      final centerLat = leg.from.lat + ((leg.to.lat - leg.from.lat) * ratio);
      final centerLng = leg.from.lng + ((leg.to.lng - leg.from.lng) * ratio);
      final latitudeRadians = centerLat * math.pi / 180;
      final metresPerLongitudeDegree =
          metresPerLatitudeDegree * math.cos(latitudeRadians).abs();
      if (metresPerLongitudeDegree < 1) break;

      final northMetres =
          (leg.to.lat - leg.from.lat) * metresPerLatitudeDegree;
      final eastMetres =
          (leg.to.lng - leg.from.lng) * metresPerLongitudeDegree;
      final magnitude = math.sqrt(
        (northMetres * northMetres) + (eastMetres * eastMetres),
      );
      if (magnitude < 1) break;
      final directionEast = eastMetres / magnitude;
      final directionNorth = northMetres / magnitude;
      final rightEast = directionNorth;
      final rightNorth = -directionEast;

      LatLng shifted({required double forward, required double right}) {
        final east = (directionEast * forward) + (rightEast * right);
        final north = (directionNorth * forward) + (rightNorth * right);
        return LatLng(
          centerLat + (north / metresPerLatitudeDegree),
          centerLng + (east / metresPerLongitudeDegree),
        );
      }

      final back = -(arrowLengthMetres * 0.48);
      final tip = arrowLengthMetres * 0.48;
      chevrons.add(
        List<LatLng>.unmodifiable([
          shifted(
            forward: back,
            right: laneOffsetMetres - wingHalfWidthMetres,
          ),
          shifted(forward: tip, right: laneOffsetMetres),
          shifted(
            forward: back,
            right: laneOffsetMetres + wingHalfWidthMetres,
          ),
        ]),
      );
      targetMetres += spacingMetres;
    }
    traversedMetres += leg.distanceMetres;
    if (chevrons.length >= desiredCount) break;
  }

  return List<List<LatLng>>.unmodifiable(chevrons);
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
  List<LocationHistoryPoint> points, {
  Geofence? originGeofence,
}) {
  if (!route.record.hasConfirmedReturn || points.isEmpty) return <Circle>{};

  final configuredZone = originGeofence;
  final hasConfiguredSafeZone = configuredZone != null &&
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
      fillColor: GuardianColors.safe,
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
  final rawPoints = route.usablePoints.isNotEmpty
      ? route.usablePoints
      : route.rawPoints.isNotEmpty
      ? route.rawPoints
      : _webSafeRecordPoints(route);
  return List.unmodifiable(
    rawPoints.where((point) {
      if (!_basicValid(point.lat, point.lng)) return false;
      final source = (point.source ?? point.accuracySource ?? '').toLowerCase();
      return point.gpsValid == true || source == 'gps';
    }),
  );
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
    final points = [
      for (final coordinate in coordinates)
        LocationHistoryPoint(
          lat: coordinate.lat,
          lng: coordinate.lng,
          source: segment.source,
          gpsValid: segment.source == 'gps',
        ),
    ].where((point) => _basicValid(point.lat, point.lng)).toList(growable: false);
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
      final offsetMs = segment.fromOffsetMs +
          ((segment.toOffsetMs - segment.fromOffsetMs) * ratio).round();
      final sourcePointIndex = segment.fromPointIndex +
          ((segment.toPointIndex - segment.fromPointIndex) * ratio).round();
      final point = LocationHistoryPoint(
        lat: coordinate.lat,
        lng: coordinate.lng,
        source: segment.source,
        accuracySource: segment.source,
        gpsValid: segment.source == 'gps',
        recordedAt: route.record.startAt.add(
          Duration(milliseconds: offsetMs),
        ),
        sourcePointIndex: sourcePointIndex,
      );
      if (!_basicValid(point.lat, point.lng)) continue;
      final previous = output.isEmpty ? null : output.last;
      final duplicate = previous != null &&
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

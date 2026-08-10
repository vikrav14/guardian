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
  });

  final JourneyV2Route route;
  final int currentIndex;

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
    final start = latLngs.first;
    final end = latLngs.last;
    final replayIndex = widget.currentIndex < 0
        ? 0
        : widget.currentIndex >= latLngs.length
        ? latLngs.length - 1
        : widget.currentIndex;
    final replayPoint = latLngs[replayIndex];

    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('journey-start'),
        position: start,
        infoWindow: const InfoWindow(title: 'Start'),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      ),
      Marker(
        markerId: const MarkerId('journey-arrival'),
        position: end,
        infoWindow: const InfoWindow(title: 'Arrival'),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
      ),
    };

    if (replayIndex > 0 && replayIndex < latLngs.length - 1) {
      markers.add(
        Marker(
          markerId: const MarkerId('journey-replay-person'),
          position: replayPoint,
          zIndexInt: 30,
          infoWindow: const InfoWindow(title: 'Replay position'),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure,
          ),
        ),
      );
    }

    final polylines = <Polyline>{
      Polyline(
        polylineId: const PolylineId('journey-route-full'),
        points: latLngs,
        color: GuardianColors.safe.withValues(alpha: 0.28),
        width: 7,
        startCap: Cap.roundCap,
        endCap: Cap.roundCap,
        jointType: JointType.round,
      ),
    };

    if (replayIndex >= 1) {
      polylines.add(
        Polyline(
          polylineId: const PolylineId('journey-route-replayed'),
          points: latLngs.sublist(0, replayIndex + 1),
          color: GuardianColors.safe,
          width: 7,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
          jointType: JointType.round,
        ),
      );
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

  final points = <LocationHistoryPoint>[
    for (var i = 0; i < coords.length; i++)
      LocationHistoryPoint(
        lat: coords[i].lat,
        lng: coords[i].lng,
        recordedAt: coords.length == 1
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

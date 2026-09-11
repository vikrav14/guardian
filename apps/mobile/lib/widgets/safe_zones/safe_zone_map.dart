import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../models/geofence.dart';
import '../../theme/app_theme.dart';
import '../map/guardian_map_presentation.dart';

/// Display geometry only. This does not decide whether a person is in a zone.
@immutable
class SafeZoneMapGeometry {
  const SafeZoneMapGeometry._({
    required this.center,
    required this.radiusMeters,
    required this.bounds,
    required double longitudeSpan,
  }) : _longitudeSpan = longitudeSpan;

  static const _earthRadiusMeters = 6371008.8;
  static const _mercatorLimit = 85.05112878;

  final LatLng center;
  final double radiusMeters;
  final LatLngBounds bounds;
  final double _longitudeSpan;

  /// Reject malformed data rather than letting LatLng silently clamp it to
  /// another place. The stored radius is never changed for presentation.
  static SafeZoneMapGeometry? fromZone(Geofence zone) {
    if (!zone.lat.isFinite ||
        !zone.lng.isFinite ||
        zone.lat < -90 ||
        zone.lat > 90 ||
        zone.lng < -180 ||
        zone.lng > 180 ||
        (zone.lat == 0 && zone.lng == 0) ||
        !zone.radiusMeters.isFinite ||
        zone.radiusMeters <= 0) {
      return null;
    }
    final latitude = zone.lat * math.pi / 180;
    final angularRadius = math.min(
      zone.radiusMeters / _earthRadiusMeters,
      math.pi,
    );
    final south = math.max(-math.pi / 2, latitude - angularRadius);
    final north = math.min(math.pi / 2, latitude + angularRadius);
    final reachesPole = south <= -math.pi / 2 || north >= math.pi / 2;
    final longitudeRadius = reachesPole
        ? 180.0
        : math.asin(
                (math.sin(angularRadius) / math.cos(latitude)).clamp(-1.0, 1.0),
              ) *
              180 /
              math.pi;
    double wrap(double longitude) => (longitude + 180) % 360 - 180;
    return SafeZoneMapGeometry._(
      center: LatLng(zone.lat, zone.lng),
      radiusMeters: zone.radiusMeters,
      bounds: LatLngBounds(
        southwest: LatLng(
          south * 180 / math.pi,
          reachesPole ? -180 : wrap(zone.lng - longitudeRadius),
        ),
        northeast: LatLng(
          north * 180 / math.pi,
          reachesPole ? 180 : wrap(zone.lng + longitudeRadius),
        ),
      ),
      longitudeSpan: longitudeRadius * 2,
    );
  }

  static double _mercatorY(double latitude) {
    final radians =
        latitude.clamp(-_mercatorLimit, _mercatorLimit) * math.pi / 180;
    return (1 - math.log(math.tan(math.pi / 4 + radians / 2)) / math.pi) / 2;
  }

  /// Fits the complete boundary with space around it, even in a narrow card.
  /// The target remains the saved centre and never follows the viewer's GPS.
  CameraPosition cameraFor(Size viewport) {
    final width = viewport.width.isFinite ? viewport.width : 320.0;
    final height = viewport.height.isFinite ? viewport.height : 240.0;
    final availableWidth = math.max(1.0, width - 80);
    final availableHeight = math.max(1.0, height - 80);
    final centerY = _mercatorY(center.latitude);
    final verticalSpan =
        2.0 *
        math.max(
          (centerY - _mercatorY(bounds.northeast.latitude)).abs(),
          (centerY - _mercatorY(bounds.southwest.latitude)).abs(),
        );
    double zoomFor(double pixels, double fraction) =>
        math.log(pixels / (256 * math.max(fraction, 1e-12))) / math.ln2;
    final zoom = math.min(
      zoomFor(availableWidth, _longitudeSpan / 360),
      zoomFor(availableHeight, verticalSpan),
    );
    return CameraPosition(target: center, zoom: zoom.clamp(0.0, 20.0));
  }
}

/// A read-only view of one saved safe zone, using the app's existing Maps SDK.
///
/// The parent supplies finite bounds and opens the expanded page. The small
/// preview leaves scrolling to the page; expanded mode permits pan and zoom.
class SafeZoneMap extends StatefulWidget {
  const SafeZoneMap({super.key, required this.zone, this.expanded = false});

  final Geofence zone;
  final bool expanded;

  @override
  State<SafeZoneMap> createState() => _SafeZoneMapState();
}

class _SafeZoneMapState extends State<SafeZoneMap> {
  GoogleMapController? _controller;
  Timer? _loadingTimer;
  Size _viewport = const Size(320, 240);
  Key _mapKey = UniqueKey();
  bool _satellite = false;
  bool _ready = false;
  bool _takingLonger = false;
  bool _fitScheduled = false;
  int _mapGeneration = 0;
  int _cameraGeneration = 0;
  BitmapDescriptor? _activePin;
  BitmapDescriptor? _pausedPin;

  @override
  void initState() {
    super.initState();
    _startLoadingTimer();
    if (SafeZoneMapGeometry.fromZone(widget.zone) != null) {
      unawaited(_loadPins());
    }
  }

  Future<void> _loadPins() async {
    try {
      final active = await _drawPin(GuardianColors.forest);
      final paused = await _drawPin(const Color(0xFF69746F));
      if (!mounted) return;
      setState(() {
        _activePin = active;
        _pausedPin = paused;
      });
    } catch (_) {
      // A standard SDK pin remains available if bitmap creation fails.
    }
  }

  Future<BitmapDescriptor> _drawPin(Color color) async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(2);
    final path = Path()
      ..moveTo(16, 38)
      ..cubicTo(12, 32, 3, 24, 3, 16)
      ..cubicTo(3, -1, 29, -1, 29, 16)
      ..cubicTo(29, 24, 20, 32, 16, 38)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
    canvas.drawPath(
      path,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
    canvas.drawCircle(const Offset(16, 15), 4, Paint()..color = Colors.white);
    final picture = recorder.endRecording();
    final bitmap = await picture.toImage(64, 80);
    try {
      final data = await bitmap.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('No pin bitmap');
      return BitmapDescriptor.bytes(
        data.buffer.asUint8List(),
        width: 32,
        height: 40,
      );
    } finally {
      bitmap.dispose();
      picture.dispose();
    }
  }

  @override
  void didUpdateWidget(covariant SafeZoneMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final previous = oldWidget.zone;
    final next = widget.zone;
    if (previous.id == next.id &&
        previous.lat == next.lat &&
        previous.lng == next.lng &&
        previous.radiusMeters == next.radiusMeters) {
      return;
    }
    _cameraGeneration++;
    final wasValid = SafeZoneMapGeometry.fromZone(previous) != null;
    final isValid = SafeZoneMapGeometry.fromZone(next) != null;
    if (wasValid != isValid) {
      _controller = null;
      _ready = false;
      _takingLonger = false;
      _mapGeneration++;
      _mapKey = UniqueKey();
      _startLoadingTimer();
      if (isValid && _activePin == null) unawaited(_loadPins());
    }
    _scheduleFit();
  }

  void _startLoadingTimer() {
    _loadingTimer?.cancel();
    if (SafeZoneMapGeometry.fromZone(widget.zone) == null) return;
    _loadingTimer = Timer(const Duration(seconds: 15), () {
      if (mounted && !_ready) setState(() => _takingLonger = true);
    });
  }

  void _scheduleFit() {
    if (_fitScheduled) return;
    _fitScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _fitScheduled = false;
      if (mounted) unawaited(_fitZone());
    });
  }

  Future<void> _fitZone() async {
    final controller = _controller;
    final geometry = SafeZoneMapGeometry.fromZone(widget.zone);
    if (!mounted || controller == null || geometry == null) return;
    final generation = ++_cameraGeneration;
    try {
      await controller.moveCamera(
        CameraUpdate.newCameraPosition(geometry.cameraFor(_viewport)),
      );
    } catch (_) {
      // A platform view can disappear while a route or selected zone changes.
      // The next live controller/selection will perform its own fit.
      if (!mounted ||
          !identical(_controller, controller) ||
          generation != _cameraGeneration) {
        return;
      }
    }
  }

  Future<void> _zoom(bool zoomIn) async {
    final controller = _controller;
    if (!mounted || controller == null) return;
    try {
      await controller.moveCamera(
        zoomIn ? CameraUpdate.zoomIn() : CameraUpdate.zoomOut(),
      );
    } catch (_) {
      // The Maps widget owns controller disposal when its route is removed.
    }
  }

  void _retry() {
    setState(() {
      _controller = null;
      _ready = false;
      _takingLonger = false;
      _mapKey = UniqueKey();
      _mapGeneration++;
      _cameraGeneration++;
    });
    _startLoadingTimer();
  }

  @override
  void dispose() {
    _loadingTimer?.cancel();
    _controller = null;
    _mapGeneration++;
    _cameraGeneration++;
    // GoogleMap disposes its own controller; do not dispose it twice.
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final geometry = SafeZoneMapGeometry.fromZone(widget.zone);
    if (geometry == null) {
      return const _MapMessage(
        title: 'Map unavailable',
        detail: 'This zone needs a valid saved centre and radius.',
      );
    }
    final colors = context.guardianColors;
    final boundaryColor = widget.zone.active
        ? colors.accent
        : colors.textSecondary;
    final generation = _mapGeneration;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, constraints.maxHeight);
        if (size != _viewport) {
          _viewport = size;
          _scheduleFit();
        }
        return Stack(
          fit: StackFit.expand,
          children: [
            GoogleMap(
              key: _mapKey,
              initialCameraPosition: geometry.cameraFor(_viewport),
              style: _satellite ? null : GuardianMapPresentation.style,
              mapType: _satellite ? MapType.hybrid : MapType.normal,
              circles: {
                Circle(
                  circleId: const CircleId('saved-zone-boundary'),
                  center: geometry.center,
                  radius: geometry.radiusMeters,
                  fillColor: boundaryColor.withValues(alpha: 0.12),
                  strokeColor: boundaryColor.withValues(alpha: 0.8),
                  strokeWidth: 2,
                ),
              },
              markers: {
                Marker(
                  markerId: const MarkerId('saved-zone-centre'),
                  position: geometry.center,
                  icon:
                      (widget.zone.active ? _activePin : _pausedPin) ??
                      BitmapDescriptor.defaultMarkerWithHue(
                        BitmapDescriptor.hueGreen,
                      ),
                  infoWindow: InfoWindow(
                    title: widget.zone.name,
                    snippet: 'Saved zone centre',
                  ),
                  consumeTapEvents: true,
                ),
              },
              scrollGesturesEnabled: widget.expanded,
              zoomGesturesEnabled: widget.expanded,
              webGestureHandling: widget.expanded
                  ? WebGestureHandling.greedy
                  : WebGestureHandling.none,
              rotateGesturesEnabled: false,
              tiltGesturesEnabled: false,
              zoomControlsEnabled: false,
              webCameraControlEnabled: false,
              myLocationEnabled: false,
              myLocationButtonEnabled: false,
              mapToolbarEnabled: false,
              compassEnabled: false,
              onMapCreated: (controller) {
                if (!mounted || generation != _mapGeneration) return;
                _loadingTimer?.cancel();
                setState(() {
                  _controller = controller;
                  _ready = true;
                  _takingLonger = false;
                });
                _scheduleFit();
              },
            ),
            if (!_ready)
              Positioned.fill(
                child: _MapMessage(
                  title: _takingLonger
                      ? 'The map is taking longer to load'
                      : 'Loading map…',
                  detail: _takingLonger
                      ? 'Check your connection and try again.'
                      : 'Finding your saved zone.',
                  onRetry: _takingLonger ? _retry : null,
                ),
              ),
            if (widget.expanded && _ready)
              Positioned(
                right: 16,
                top: 16,
                child: _MapControls(
                  satellite: _satellite,
                  onToggleSatellite: () =>
                      setState(() => _satellite = !_satellite),
                  onRecenter: () => unawaited(_fitZone()),
                  onZoomIn: () => unawaited(_zoom(true)),
                  onZoomOut: () => unawaited(_zoom(false)),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _MapControls extends StatelessWidget {
  const _MapControls({
    required this.satellite,
    required this.onToggleSatellite,
    required this.onRecenter,
    required this.onZoomIn,
    required this.onZoomOut,
  });

  final bool satellite;
  final VoidCallback onToggleSatellite;
  final VoidCallback onRecenter;
  final VoidCallback onZoomIn;
  final VoidCallback onZoomOut;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final controls = Material(
      color: colors.surface,
      elevation: 2,
      borderRadius: BorderRadius.circular(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _button('Zoom in', Icons.add_rounded, onZoomIn),
          _button('Zoom out', Icons.remove_rounded, onZoomOut),
          _button(
            'Show whole safe zone',
            Icons.center_focus_strong_rounded,
            onRecenter,
          ),
          _button(
            satellite ? 'Switch to map view' : 'Switch to satellite view',
            satellite ? Icons.map_outlined : Icons.satellite_alt_outlined,
            onToggleSatellite,
          ),
        ],
      ),
    );
    return kIsWeb ? PointerInterceptor(child: controls) : controls;
  }

  Widget _button(String tooltip, IconData icon, VoidCallback onPressed) {
    return SizedBox(
      width: 48,
      height: 48,
      child: IconButton(
        tooltip: tooltip,
        icon: Icon(icon, size: 22),
        onPressed: onPressed,
      ),
    );
  }
}

class _MapMessage extends StatelessWidget {
  const _MapMessage({required this.title, required this.detail, this.onRetry});

  final String title;
  final String detail;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final message = ColoredBox(
      color: colors.surfaceMuted,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.map_outlined, color: colors.textSecondary, size: 28),
                const SizedBox(height: 12),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  detail,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: colors.textSecondary, fontSize: 14),
                ),
                if (onRetry != null) ...[
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: onRetry,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(48, 48),
                    ),
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Retry map'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
    return kIsWeb ? PointerInterceptor(child: message) : message;
  }
}

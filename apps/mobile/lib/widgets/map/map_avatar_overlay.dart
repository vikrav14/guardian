import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';

/// Web map avatars rendered as Flutter widgets above the Google Map.
///
/// Bitmap map markers cannot read Firebase Storage token URL bytes without
/// bucket CORS. [AvatarBubble] uses HTML `<img>` (same as device cards).
class MapAvatarOverlay extends StatefulWidget {
  const MapAvatarOverlay({
    super.key,
    required this.controller,
    required this.devices,
    required this.selectedImei,
    required this.cameraGeneration,
    required this.onSelect,
  });

  final GoogleMapController? controller;
  final List<Device> devices;
  final String? selectedImei;
  final int cameraGeneration;
  final ValueChanged<String> onSelect;

  @override
  State<MapAvatarOverlay> createState() => _MapAvatarOverlayState();
}

class _MapAvatarOverlayState extends State<MapAvatarOverlay> {
  Map<String, Offset> _positions = const {};
  var _trackedCameraGeneration = -1;
  var _deviceFingerprint = '';

  @override
  void initState() {
    super.initState();
    unawaited(_updatePositions());
  }

  @override
  void didUpdateWidget(covariant MapAvatarOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    final fingerprint = _fingerprint(widget.devices);
    if (widget.controller != oldWidget.controller ||
        widget.cameraGeneration != _trackedCameraGeneration ||
        fingerprint != _deviceFingerprint) {
      unawaited(_updatePositions());
    }
  }

  String _fingerprint(List<Device> devices) {
    return devices
        .map(
          (device) =>
              '${device.imei}|${device.avatarUrl ?? ''}|'
              '${device.location?.lat}|${device.location?.lng}',
        )
        .join('||');
  }

  Future<void> _updatePositions() async {
    final controller = widget.controller;
    if (controller == null || !mounted) return;

    _deviceFingerprint = _fingerprint(widget.devices);
    _trackedCameraGeneration = widget.cameraGeneration;

    final positions = <String, Offset>{};
    for (final device in widget.devices) {
      if (!device.hasFreshLocation) continue;
      final location = device.location!;
      try {
        final screen = await controller.getScreenCoordinate(
          LatLng(location.lat, location.lng),
        );
        positions[device.imei] =
            Offset(screen.x.toDouble(), screen.y.toDouble());
      } catch (_) {
        // The map may not be ready yet.
      }
    }

    if (!mounted) return;
    setState(() => _positions = positions);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        for (final device in widget.devices)
          if (_positions.containsKey(device.imei))
            _AvatarMarker(
              position: _positions[device.imei]!,
              device: device,
              selected: device.imei == widget.selectedImei,
              onTap: () => widget.onSelect(device.imei),
            ),
      ],
    );
  }
}

/// A lat/lng slot rendered as an avatar on the journey map (start / end / replay).
class JourneyMapAvatarSlot {
  const JourneyMapAvatarSlot({
    required this.id,
    required this.latLng,
    this.selected = false,
  });

  final String id;
  final LatLng latLng;
  final bool selected;
}

/// Web journey map avatars at route start, end, and replay position.
class JourneyMapAvatarOverlay extends StatefulWidget {
  const JourneyMapAvatarOverlay({
    super.key,
    required this.controller,
    required this.slots,
    required this.cameraGeneration,
    required this.deviceName,
    required this.imei,
    this.avatarUrl,
  });

  final GoogleMapController? controller;
  final List<JourneyMapAvatarSlot> slots;
  final int cameraGeneration;
  final String deviceName;
  final String imei;
  final String? avatarUrl;

  @override
  State<JourneyMapAvatarOverlay> createState() =>
      _JourneyMapAvatarOverlayState();
}

class _JourneyMapAvatarOverlayState extends State<JourneyMapAvatarOverlay> {
  Map<String, Offset> _positions = const {};
  var _trackedCameraGeneration = -1;
  var _slotFingerprint = '';

  @override
  void initState() {
    super.initState();
    unawaited(_updatePositions());
  }

  @override
  void didUpdateWidget(covariant JourneyMapAvatarOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    final fingerprint = _fingerprint(widget.slots);
    if (widget.controller != oldWidget.controller ||
        widget.cameraGeneration != _trackedCameraGeneration ||
        fingerprint != _slotFingerprint) {
      unawaited(_updatePositions());
    }
  }

  String _fingerprint(List<JourneyMapAvatarSlot> slots) {
    return slots
        .map(
          (slot) =>
              '${slot.id}|${slot.latLng.latitude}|${slot.latLng.longitude}|'
              '${slot.selected}',
        )
        .join('||');
  }

  Future<void> _updatePositions() async {
    final controller = widget.controller;
    if (controller == null || !mounted) return;

    _slotFingerprint = _fingerprint(widget.slots);
    _trackedCameraGeneration = widget.cameraGeneration;

    final positions = <String, Offset>{};
    for (final slot in widget.slots) {
      try {
        final screen = await controller.getScreenCoordinate(slot.latLng);
        positions[slot.id] =
            Offset(screen.x.toDouble(), screen.y.toDouble());
      } catch (_) {
        // The map may not be ready yet.
      }
    }

    if (!mounted) return;
    setState(() => _positions = positions);
  }

  @override
  Widget build(BuildContext context) {
    final initials = initialsFor(widget.deviceName);
    final color = avatarColorForKey(widget.imei);

    return Stack(
      clipBehavior: Clip.none,
      children: [
        for (final slot in widget.slots)
          if (_positions.containsKey(slot.id))
            _JourneyAvatarMarker(
              position: _positions[slot.id]!,
              initials: initials,
              color: color,
              selected: slot.selected,
              imageUrl: widget.avatarUrl,
            ),
      ],
    );
  }
}

class _JourneyAvatarMarker extends StatelessWidget {
  const _JourneyAvatarMarker({
    required this.position,
    required this.initials,
    required this.color,
    required this.selected,
    this.imageUrl,
  });

  final Offset position;
  final String initials;
  final Color color;
  final bool selected;
  final String? imageUrl;

  static const _markerSize = 58.0;
  static const _selectedSize = 62.0;

  @override
  Widget build(BuildContext context) {
    final size = selected ? _selectedSize : _markerSize;
    return Positioned(
      left: position.dx - size / 2,
      top: position.dy - size,
      child: PointerInterceptor(
        child: AvatarBubble(
          initials: initials,
          color: color,
          size: size,
          ringWidth: selected ? 3 : 2,
          imageUrl: imageUrl,
        ),
      ),
    );
  }
}

class _AvatarMarker extends StatelessWidget {
  const _AvatarMarker({
    required this.position,
    required this.device,
    required this.selected,
    required this.onTap,
  });

  final Offset position;
  final Device device;
  final bool selected;
  final VoidCallback onTap;

  static const _markerSize = 58.0;
  static const _selectedSize = 62.0;

  @override
  Widget build(BuildContext context) {
    final size = selected ? _selectedSize : _markerSize;
    final color = avatarColorForKey(device.imei);
    return Positioned(
      left: position.dx - size / 2,
      top: position.dy - size,
      child: PointerInterceptor(
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: AvatarBubble(
            initials: initialsFor(device.displayName),
            color: color,
            size: size,
            ringWidth: selected ? 3 : 2,
            imageUrl: device.avatarUrl,
          ),
        ),
      ),
    );
  }
}

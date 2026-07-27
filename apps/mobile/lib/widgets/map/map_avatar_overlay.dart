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
              label: widget.deviceName,
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
    required this.label,
    required this.initials,
    required this.color,
    required this.selected,
    this.imageUrl,
  });

  final Offset position;
  final String label;
  final String initials;
  final Color color;
  final bool selected;
  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final markerSize = _TrackedPersonPin.markerSize(selected);
    final markerHeight = _TrackedPersonPin.markerHeight(selected);
    return Positioned(
      left: position.dx - markerSize / 2,
      top: position.dy - markerHeight,
      child: PointerInterceptor(
        child: _TrackedPersonPin(
          label: label,
          initials: initials,
          color: color,
          selected: selected,
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

  @override
  Widget build(BuildContext context) {
    final markerSize = _TrackedPersonPin.markerSize(selected);
    final markerHeight = _TrackedPersonPin.markerHeight(selected);
    final color = avatarColorForKey(device.imei);
    return Positioned(
      left: position.dx - markerSize / 2,
      top: position.dy - markerHeight,
      child: PointerInterceptor(
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: _TrackedPersonPin(
            label: device.displayName,
            initials: initialsFor(device.displayName),
            color: color,
            selected: selected,
            imageUrl: device.avatarUrl,
          ),
        ),
      ),
    );
  }
}

/// Compact person-first map marker shared by live tracking and journey replay.
///
/// The stable per-device colour and initials remain useful when no photo is
/// available, while the white pointer keeps the exact map position readable.
class _TrackedPersonPin extends StatelessWidget {
  const _TrackedPersonPin({
    required this.label,
    required this.initials,
    required this.color,
    required this.selected,
    this.imageUrl,
  });

  final String label;
  final String initials;
  final Color color;
  final bool selected;
  final String? imageUrl;

  static double avatarSize(bool selected) => selected ? 48 : 42;
  static double markerSize(bool selected) =>
      selected ? 118 : avatarSize(selected) + 12;
  static double markerHeight(bool selected) =>
      selected ? 89 : avatarSize(selected) + 15;

  @override
  Widget build(BuildContext context) {
    final avatar = avatarSize(selected);
    final width = markerSize(selected);
    final height = markerHeight(selected);
    final ringColor = color;

    return Semantics(
      label: '$label location',
      image: true,
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.topCenter,
          children: [
            if (selected)
              Positioned(
                top: 0,
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 112),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: GuardianColors.forest,
                    borderRadius: BorderRadius.circular(999),
                    boxShadow: [
                      BoxShadow(
                        color: GuardianColors.forest.withValues(alpha: 0.2),
                        blurRadius: 12,
                        offset: const Offset(0, 5),
                      ),
                    ],
                  ),
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            Positioned(
              bottom: 3,
              child: Transform.rotate(
                angle: 0.785398,
                child: Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border(
                      right: BorderSide(color: ringColor, width: 2),
                      bottom: BorderSide(color: ringColor, width: 2),
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: selected ? 27 : 0,
              child: Container(
                width: avatar + 8,
                height: avatar + 8,
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: ringColor,
                    width: selected ? 3 : 2,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color:
                          (selected ? GuardianColors.safe : color).withValues(
                        alpha: selected ? 0.24 : 0.14,
                      ),
                      blurRadius: selected ? 16 : 10,
                      offset: const Offset(0, 5),
                    ),
                  ],
                ),
                child: AvatarBubble(
                  initials: initials,
                  color: color,
                  size: avatar,
                  ringWidth: 0,
                  imageUrl: imageUrl,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

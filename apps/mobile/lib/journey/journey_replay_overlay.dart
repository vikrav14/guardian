import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../theme/app_theme.dart';
import '../widgets/guardian_widgets.dart';

/// Animate in Flutter, not by sending native map objects on every frame.
/// Projection requests are serialized and coalesced while the camera moves.
class JourneyReplayOverlay extends StatefulWidget {
  const JourneyReplayOverlay({
    super.key,
    required this.controller,
    required this.position,
    required this.cameraGeneration,
    required this.deviceName,
    required this.identityKey,
    this.recordedAt,
    this.avatarUrl,
    this.animatePosition = true,
  });

  final GoogleMapController? controller;
  final LatLng position;
  final int cameraGeneration;
  final String deviceName;
  final String identityKey;
  final DateTime? recordedAt;
  final String? avatarUrl;
  final bool animatePosition;

  @override
  State<JourneyReplayOverlay> createState() => _JourneyReplayOverlayState();
}

class _JourneyReplayOverlayState extends State<JourneyReplayOverlay> {
  Offset? _screenPosition;
  bool _projecting = false;
  bool _projectionPending = false;
  bool _animate = false;
  bool _active = true;
  double _pixelRatio = 1;
  int _requestGeneration = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _active = TickerMode.valuesOf(context).enabled;
    // Android's projection API returns physical pixels; web returns CSS pixels.
    _pixelRatio = !kIsWeb && defaultTargetPlatform == TargetPlatform.android
        ? MediaQuery.devicePixelRatioOf(context)
        : 1;
    _requestProjection(animate: false);
  }

  @override
  void didUpdateWidget(covariant JourneyReplayOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    final cameraChanged =
        oldWidget.controller != widget.controller ||
        oldWidget.cameraGeneration != widget.cameraGeneration;
    if (cameraChanged || oldWidget.position != widget.position) {
      _requestProjection(animate: !cameraChanged && widget.animatePosition);
    }
  }

  void _requestProjection({required bool animate}) {
    _requestGeneration++;
    _animate = animate;
    _projectionPending = true;
    if (!_projecting && _active) unawaited(_project());
  }

  Future<void> _project() async {
    _projecting = true;
    try {
      while (mounted && _active && _projectionPending) {
        _projectionPending = false;
        final controller = widget.controller;
        if (controller == null) return;
        final generation = _requestGeneration;
        try {
          final screen = await controller.getScreenCoordinate(widget.position);
          if (!mounted || !_active) return;
          if (generation != _requestGeneration) continue;
          setState(() {
            _screenPosition = Offset(
              screen.x / _pixelRatio,
              screen.y / _pixelRatio,
            );
          });
        } catch (_) {
          // A projection can finish after its platform map has been removed.
          // A later map/camera event will request a fresh position.
        }
      }
    } finally {
      _projecting = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final position = _screenPosition;
    if (position == null) return const SizedBox.shrink();
    return IgnorePointer(
      child: TweenAnimationBuilder<Offset>(
        tween: Tween<Offset>(begin: position, end: position),
        duration: _animate ? const Duration(milliseconds: 680) : Duration.zero,
        curve: Curves.easeInOutCubic,
        child: RepaintBoundary(
          child: _ReplayAvatar(
            deviceName: widget.deviceName,
            avatarUrl: widget.avatarUrl,
            recordedAt: widget.recordedAt,
          ),
        ),
        builder: (context, offset, child) => LayoutBuilder(
          builder: (context, constraints) {
            // Keep the photo centred on its coordinate, moving only the label
            // to the other side when it would run off the edge of the map.
            final labelOnLeft = offset.dx + 170 > constraints.maxWidth;
            return Stack(
              children: [
                Positioned(
                  left: offset.dx - 20 - (labelOnLeft ? 150 : 0),
                  top: offset.dy - 20,
                  width: 190,
                  height: 40,
                  child: Directionality(
                    textDirection: labelOnLeft
                        ? TextDirection.rtl
                        : TextDirection.ltr,
                    child: child!,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ReplayAvatar extends StatelessWidget {
  const _ReplayAvatar({
    required this.deviceName,
    required this.recordedAt,
    this.avatarUrl,
  });

  final String deviceName;
  final String? avatarUrl;
  final DateTime? recordedAt;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final time = recordedAt == null ? '—' : DateFormat.Hm().format(recordedAt!);
    return Semantics(
      label: '$deviceName at $time, journey history',
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: colors.surface,
              border: Border.all(color: const Color(0xFF555BD3), width: 2),
            ),
            child: AvatarBubble(
              initials: initialsFor(deviceName),
              color: const Color(0xFF555BD3),
              size: 30,
              ringWidth: 0,
              imageUrl: avatarUrl,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Directionality(
              textDirection: TextDirection.ltr,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(color: colors.border),
                ),
                child: DefaultTextStyle(
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          deviceName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(' · $time'),
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

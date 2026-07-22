import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/colors.dart';

/// Full-screen map picker: pan the map so the fixed center pin sits over the
/// desired spot (e.g. home), then confirm. Returns the picked [LatLng], or
/// null if the user backs out.
class LocationPickerPage extends StatefulWidget {
  const LocationPickerPage({
    super.key,
    required this.initialCenter,
    this.radiusMeters = 150,
    this.zoneColor,
  });

  final LatLng initialCenter;

  /// Geofence radius preview shown as a map circle (meters).
  final double radiusMeters;

  /// Zone-type accent for the preview circle; defaults to [GuardianColors.safe].
  final Color? zoneColor;

  @override
  State<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends State<LocationPickerPage> {
  late LatLng _center = widget.initialCenter;

  Color get _accent => widget.zoneColor ?? GuardianColors.safe;

  Set<Circle> get _circles => {
        Circle(
          circleId: const CircleId('preview'),
          center: _center,
          radius: widget.radiusMeters,
          fillColor: _accent.withValues(alpha: 0.18),
          strokeColor: _accent,
          strokeWidth: 2,
        ),
      };

  @override
  Widget build(BuildContext context) {
    final radiusLabel = '${widget.radiusMeters.round()} m radius';

    return Scaffold(
      appBar: AppBar(title: const Text('Choose safe zone center')),
      body: Stack(
        alignment: Alignment.center,
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _center, zoom: 16),
            onCameraMove: (pos) {
              final target = pos.target;
              if (_center.latitude != target.latitude ||
                  _center.longitude != target.longitude) {
                setState(() => _center = target);
              }
            },
            circles: _circles,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: true,
            mapToolbarEnabled: false,
          ),
          const IgnorePointer(
            child: Padding(
              padding: EdgeInsets.only(bottom: 36),
              child: Icon(Icons.location_pin, size: 44, color: Colors.redAccent),
            ),
          ),
          Positioned(
            top: 12,
            left: 0,
            right: 0,
            child: Center(
              child: Material(
                elevation: 2,
                borderRadius: BorderRadius.circular(20),
                color: Colors.white,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: Text(
                    radiusLabel,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: _accent,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: FilledButton(
              onPressed: () => Navigator.pop(context, _center),
              child: const Text('Use this location'),
            ),
          ),
        ],
      ),
    );
  }
}

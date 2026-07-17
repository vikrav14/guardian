import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

/// Full-screen map picker: pan the map so the fixed center pin sits over the
/// desired spot (e.g. home), then confirm. Returns the picked [LatLng], or
/// null if the user backs out.
class LocationPickerPage extends StatefulWidget {
  const LocationPickerPage({super.key, required this.initialCenter});

  final LatLng initialCenter;

  @override
  State<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends State<LocationPickerPage> {
  late LatLng _center = widget.initialCenter;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose safe zone center')),
      body: Stack(
        alignment: Alignment.center,
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(target: _center, zoom: 16),
            onCameraMove: (pos) => _center = pos.target,
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

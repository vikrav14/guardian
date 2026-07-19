import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../models/location_history_point.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';

class RouteHistoryPage extends StatefulWidget {
  const RouteHistoryPage({super.key, required this.imei, required this.deviceName});

  final String imei;
  final String deviceName;

  @override
  State<RouteHistoryPage> createState() => _RouteHistoryPageState();
}

class _RouteHistoryPageState extends State<RouteHistoryPage> {
  late DateTime _day = DateTime.now();
  GoogleMapController? _mapController;
  bool _didFitForDay = false;

  bool get _isToday {
    final now = DateTime.now();
    return _day.year == now.year && _day.month == now.month && _day.day == now.day;
  }

  void _changeDay(int deltaDays) {
    setState(() {
      _day = _day.add(Duration(days: deltaDays));
      _didFitForDay = false;
    });
  }

  Future<void> _fitBounds(List<LocationHistoryPoint> points) async {
    final controller = _mapController;
    if (controller == null || points.isEmpty || _didFitForDay) return;
    _didFitForDay = true;

    if (points.length == 1) {
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(points.first.lat, points.first.lng), 15),
      );
      return;
    }

    double minLat = points.first.lat, maxLat = points.first.lat;
    double minLng = points.first.lng, maxLng = points.first.lng;
    for (final p in points) {
      minLat = minLat < p.lat ? minLat : p.lat;
      maxLat = maxLat > p.lat ? maxLat : p.lat;
      minLng = minLng < p.lng ? minLng : p.lng;
      maxLng = maxLng > p.lng ? maxLng : p.lng;
    }
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)),
        48,
      ),
    );
  }

  @override
  void dispose() {
    _mapController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dayLabel = DateFormat.yMMMEd().format(_day);

    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      appBar: AppBar(
        title: Text('${widget.deviceName} · route'),
        backgroundColor: GuardianColors.surface,
        foregroundColor: GuardianColors.textPrimary,
        elevation: 0,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  onPressed: () => _changeDay(-1),
                ),
                Text(dayLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _isToday ? null : () => _changeDay(1),
                ),
              ],
            ),
          ),
          Expanded(
            child: StreamBuilder<List<LocationHistoryPoint>>(
              key: ValueKey(_day),
              stream: DeviceService().watchDayHistory(widget.imei, _day),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(child: Text('${snapshot.error}'));
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final points = snapshot.data!;
                if (points.isEmpty) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No location history for this day.',
                        style: TextStyle(color: GuardianColors.textSecondary),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }

                WidgetsBinding.instance.addPostFrameCallback((_) => _fitBounds(points));
                final first = points.first;
                final last = points.last;

                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '${points.length} points'
                          '${first.recordedAt != null && last.recordedAt != null ? ' · ${DateFormat.Hm().format(first.recordedAt!)} – ${DateFormat.Hm().format(last.recordedAt!)}' : ''}',
                          style: const TextStyle(fontSize: 12, color: GuardianColors.textSecondary),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(16),
                          child: GoogleMap(
                            initialCameraPosition: CameraPosition(
                              target: LatLng(first.lat, first.lng),
                              zoom: 14,
                            ),
                            onMapCreated: (controller) {
                              _mapController = controller;
                              _fitBounds(points);
                            },
                            polylines: {
                              Polyline(
                                polylineId: const PolylineId('route'),
                                points: points.map((p) => LatLng(p.lat, p.lng)).toList(),
                                color: GuardianColors.accent,
                                width: 4,
                              ),
                            },
                            markers: {
                              Marker(
                                markerId: const MarkerId('start'),
                                position: LatLng(first.lat, first.lng),
                                icon: BitmapDescriptor.defaultMarkerWithHue(
                                  BitmapDescriptor.hueGreen,
                                ),
                                infoWindow: const InfoWindow(title: 'Start'),
                              ),
                              if (points.length > 1)
                                Marker(
                                  markerId: const MarkerId('end'),
                                  position: LatLng(last.lat, last.lng),
                                  icon: BitmapDescriptor.defaultMarkerWithHue(
                                    BitmapDescriptor.hueRose,
                                  ),
                                  infoWindow: const InfoWindow(title: 'Latest'),
                                ),
                            },
                            zoomControlsEnabled: true,
                            mapToolbarEnabled: false,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

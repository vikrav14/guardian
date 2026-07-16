import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../models/device.dart';
import '../services/auth_service.dart';
import 'alerts_page.dart';

class MapDashboardPage extends StatefulWidget {
  const MapDashboardPage({super.key});

  @override
  State<MapDashboardPage> createState() => _MapDashboardPageState();
}

class _MapDashboardPageState extends State<MapDashboardPage> {
  final _mapController = MapController();
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _sub;

  List<Device> _devices = const [];
  String? _selectedImei;
  String? _error;
  bool _loading = true;
  bool _didFit = false;

  static const _mauritius = LatLng(-20.2642, 57.4791);

  @override
  void initState() {
    super.initState();
    _sub = FirebaseFirestore.instance.collection('devices').snapshots().listen(
      (snapshot) {
        final devices = snapshot.docs.map(Device.fromDoc).toList();
        if (!mounted) return;
        setState(() {
          _devices = devices;
          _loading = false;
          _error = null;
          if (_selectedImei == null && devices.isNotEmpty) {
            _selectedImei = devices.first.imei;
          } else if (devices.every((d) => d.imei != _selectedImei)) {
            _selectedImei = devices.isEmpty ? null : devices.first.imei;
          }
        });
        _fitIfNeeded(devices);
      },
      onError: (Object err) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = err.toString();
        });
      },
    );
  }

  void _fitIfNeeded(List<Device> devices) {
    if (_didFit) return;
    final points = devices
        .where((d) => d.location?.isValid == true)
        .map((d) => LatLng(d.location!.lat, d.location!.lng))
        .toList();
    if (points.isEmpty) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _didFit) return;
      try {
        if (points.length == 1) {
          _mapController.move(points.first, 14);
        } else {
          _mapController.fitCamera(
            CameraFit.bounds(
              bounds: LatLngBounds.fromPoints(points),
              padding: const EdgeInsets.all(48),
            ),
          );
        }
        _didFit = true;
      } catch (_) {
        // Map not ready yet; will retry on next snapshot.
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  Device? get _selected {
    if (_devices.isEmpty) return null;
    return _devices.firstWhere(
      (d) => d.imei == _selectedImei,
      orElse: () => _devices.first,
    );
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    final center = selected?.location?.isValid == true
        ? LatLng(selected!.location!.lat, selected.location!.lng)
        : _mauritius;

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 13,
            ),
            children: [
              TileLayer(
                // Esri World Street Map — CORS-friendly, reliable on Flutter web.
                urlTemplate:
                    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
                userAgentPackageName: 'mu.guardian.app',
                tileProvider: CancellableNetworkTileProvider(),
              ),
              MarkerLayer(
                markers: [
                  for (final device in _devices)
                    if (device.location?.isValid == true)
                      Marker(
                        point: LatLng(device.location!.lat, device.location!.lng),
                        width: 44,
                        height: 44,
                        child: GestureDetector(
                          onTap: () => setState(() => _selectedImei = device.imei),
                          child: _DeviceMarker(
                            color: _accuracyColor(device.accuracySource),
                            selected: device.imei == selected?.imei,
                            online: device.online,
                          ),
                        ),
                      ),
                ],
              ),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(
                children: [
                  _BrandChip(),
                  const Spacer(),
                  _LegendChip(),
                  const SizedBox(width: 8),
                  _RoundIconButton(
                    tooltip: 'Alerts',
                    icon: Icons.notifications_none,
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const AlertsPage()),
                      );
                    },
                  ),
                  const SizedBox(width: 8),
                  _RoundIconButton(
                    tooltip: 'Sign out',
                    icon: Icons.logout,
                    onPressed: () => AuthService().signOut(),
                  ),
                ],
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 16),
                child: _ZoomControls(
                  onZoomIn: () {
                    final cam = _mapController.camera;
                    _mapController.move(cam.center, (cam.zoom + 1).clamp(3, 19));
                  },
                  onZoomOut: () {
                    final cam = _mapController.camera;
                    _mapController.move(cam.center, (cam.zoom - 1).clamp(3, 19));
                  },
                ),
              ),
            ),
          ),
          if (_loading)
            const Align(
              alignment: Alignment.center,
              child: CircularProgressIndicator(),
            ),
          if (_error != null)
            Align(
              alignment: Alignment.center,
              child: _ErrorBody(message: _error!),
            ),
          if (!_loading && _error == null && _devices.isEmpty)
            const Align(
              alignment: Alignment.center,
              child: _EmptyBody(),
            ),
          if (selected != null)
            Align(
              alignment: Alignment.bottomCenter,
              child: _DeviceSheet(
                device: selected,
                devices: _devices,
                onSelect: (imei) {
                  setState(() => _selectedImei = imei);
                  final d = _devices.firstWhere((x) => x.imei == imei);
                  if (d.location?.isValid == true) {
                    _mapController.move(
                      LatLng(d.location!.lat, d.location!.lng),
                      15,
                    );
                  }
                },
              ),
            ),
        ],
      ),
    );
  }

  Color _accuracyColor(String? source) {
    switch (source) {
      case 'gps':
        return const Color(0xFF1F8A4C);
      case 'wifi':
        return const Color(0xFF2F6FED);
      case 'lbs':
        return const Color(0xFFD97706);
      default:
        return const Color(0xFF6B7280);
    }
  }
}

class _DeviceMarker extends StatelessWidget {
  const _DeviceMarker({
    required this.color,
    required this.selected,
    required this.online,
  });

  final Color color;
  final bool selected;
  final bool online;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(
          color: Colors.white,
          width: selected ? 3.5 : 2,
        ),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.45),
            blurRadius: selected ? 14 : 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Icon(
        online ? Icons.person_pin_circle : Icons.person_off,
        color: Colors.white,
        size: selected ? 26 : 22,
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xF2F7F4EF),
      borderRadius: BorderRadius.circular(12),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: Icon(icon, color: const Color(0xFF1C2B24)),
      ),
    );
  }
}

class _ZoomControls extends StatelessWidget {
  const _ZoomControls({
    required this.onZoomIn,
    required this.onZoomOut,
  });

  final VoidCallback onZoomIn;
  final VoidCallback onZoomOut;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xF2F7F4EF),
      elevation: 2,
      borderRadius: BorderRadius.circular(14),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'Zoom in',
            onPressed: onZoomIn,
            icon: const Icon(Icons.add, color: Color(0xFF1C2B24)),
          ),
          Container(width: 28, height: 1, color: const Color(0x331C2B24)),
          IconButton(
            tooltip: 'Zoom out',
            onPressed: onZoomOut,
            icon: const Icon(Icons.remove, color: Color(0xFF1C2B24)),
          ),
        ],
      ),
    );
  }
}

class _BrandChip extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xE6F7F4EF),
        borderRadius: BorderRadius.circular(14),
      ),
      child: const Text(
        'Guardian',
        style: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: Color(0xFF1C2B24),
        ),
      ),
    );
  }
}

class _LegendChip extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    Widget item(Color c, String label) => Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle),
            ),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF1C2B24))),
          ],
        );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xE6F7F4EF),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          item(const Color(0xFF1F8A4C), 'GPS'),
          const SizedBox(width: 8),
          item(const Color(0xFF2F6FED), 'WiFi'),
          const SizedBox(width: 8),
          item(const Color(0xFFD97706), 'LBS'),
        ],
      ),
    );
  }
}

class _DeviceSheet extends StatelessWidget {
  const _DeviceSheet({
    required this.device,
    required this.devices,
    required this.onSelect,
  });

  final Device device;
  final List<Device> devices;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final timeFmt = DateFormat('HH:mm:ss');
    final heartbeat = device.lastHeartbeatAt != null
        ? timeFmt.format(device.lastHeartbeatAt!.toLocal())
        : '—';

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        color: const Color(0xF2F7F4EF),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0x331C2B24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (devices.length > 1) ...[
            SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: devices.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final d = devices[index];
                  final selected = d.imei == device.imei;
                  return ChoiceChip(
                    label: Text(d.displayName),
                    selected: selected,
                    onSelected: (_) => onSelect(d.imei),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  device.displayName,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1C2B24),
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: device.online
                      ? const Color(0x331F8A4C)
                      : const Color(0x33B91C1C),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  device.online ? 'Online' : 'Offline',
                  style: TextStyle(
                    color: device.online
                        ? const Color(0xFF1F8A4C)
                        : const Color(0xFFB91C1C),
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'IMEI ${device.imei}',
            style: const TextStyle(color: Color(0xFF5C6B63), fontSize: 12),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _Stat(
                label: 'Battery',
                value: device.batteryPercent != null ? '${device.batteryPercent}%' : '—',
              ),
              _Stat(
                label: 'Speed',
                value: device.speedKmh != null ? '${device.speedKmh} km/h' : '—',
              ),
              _Stat(
                label: 'Source',
                value: (device.accuracySource ?? '—').toUpperCase(),
              ),
              _Stat(label: 'Heartbeat', value: heartbeat),
            ],
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF5C6B63))),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1C2B24),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyBody extends StatelessWidget {
  const _EmptyBody();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xCCF7F4EF),
      borderRadius: BorderRadius.circular(16),
      child: const Padding(
        padding: EdgeInsets.all(20),
        child: Text(
          'No devices yet.\nRun the gateway simulator to create one.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 16, height: 1.4),
        ),
      ),
    );
  }
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xCCF7F4EF),
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Text(
          'Could not load devices.\n$message',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}

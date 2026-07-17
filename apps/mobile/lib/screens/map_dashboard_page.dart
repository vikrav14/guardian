import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/guardian_widgets.dart';

class MapDashboardPage extends StatefulWidget {
  const MapDashboardPage({super.key});

  @override
  State<MapDashboardPage> createState() => _MapDashboardPageState();
}

class _MapDashboardPageState extends State<MapDashboardPage> {
  GoogleMapController? _mapController;
  StreamSubscription<List<Device>>? _sub;
  StreamSubscription<List<Geofence>>? _geofenceSub;

  List<Device> _devices = const [];
  List<Geofence> _geofences = const [];
  String? _selectedImei;
  String? _error;
  bool _loading = true;
  bool _didFit = false;
  bool _sendingHelp = false;
  double _zoom = 13;

  static const _mauritius = LatLng(-20.2642, 57.4791);

  static const _markerHues = [
    BitmapDescriptor.hueGreen,
    BitmapDescriptor.hueOrange,
    BitmapDescriptor.hueRose,
    BitmapDescriptor.hueAzure,
  ];

  @override
  void initState() {
    super.initState();
    _sub = DeviceService().watchLinkedDevices().listen(
      (devices) {
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
        _followSelected(devices);
      },
      onError: (Object err) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = err.toString();
        });
      },
    );
    _geofenceSub = GeofenceService().watchAll().listen((zones) {
      if (!mounted) return;
      setState(() => _geofences = zones);
    });
  }

  Future<void> _animateTo(LatLng target, {double? zoom}) async {
    final controller = _mapController;
    if (controller == null) return;
    final z = zoom ?? _zoom;
    await controller.animateCamera(CameraUpdate.newLatLngZoom(target, z));
    _zoom = z;
  }

  void _fitIfNeeded(List<Device> devices) {
    if (_didFit) return;
    final points = devices
        .where((d) => d.location?.isValid == true)
        .map((d) => LatLng(d.location!.lat, d.location!.lng))
        .toList();
    if (points.isEmpty) return;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || _didFit || _mapController == null) return;
      try {
        if (points.length == 1) {
          await _animateTo(points.first, zoom: 14);
        } else {
          double minLat = points.first.latitude;
          double maxLat = points.first.latitude;
          double minLng = points.first.longitude;
          double maxLng = points.first.longitude;
          for (final p in points) {
            minLat = minLat < p.latitude ? minLat : p.latitude;
            maxLat = maxLat > p.latitude ? maxLat : p.latitude;
            minLng = minLng < p.longitude ? minLng : p.longitude;
            maxLng = maxLng > p.longitude ? maxLng : p.longitude;
          }
          await _mapController!.animateCamera(
            CameraUpdate.newLatLngBounds(
              LatLngBounds(
                southwest: LatLng(minLat, minLng),
                northeast: LatLng(maxLat, maxLng),
              ),
              48,
            ),
          );
        }
        _didFit = true;
      } catch (_) {}
    });
  }

  void _followSelected(List<Device> devices) {
    if (!_didFit || _selectedImei == null) return;
    Device? selected;
    for (final d in devices) {
      if (d.imei == _selectedImei) {
        selected = d;
        break;
      }
    }
    final loc = selected?.location;
    if (loc == null || !loc.isValid) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _animateTo(LatLng(loc.lat, loc.lng));
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _geofenceSub?.cancel();
    _mapController?.dispose();
    super.dispose();
  }

  Device? get _selected {
    if (_devices.isEmpty) return null;
    return _devices.firstWhere(
      (d) => d.imei == _selectedImei,
      orElse: () => _devices.first,
    );
  }

  double _hueForImei(String imei) {
    return _markerHues[imei.hashCode.abs() % _markerHues.length];
  }

  Set<Marker> _markers() {
    return {
      for (final device in _devices)
        if (device.location?.isValid == true)
          Marker(
            markerId: MarkerId(device.imei),
            position: LatLng(device.location!.lat, device.location!.lng),
            infoWindow: InfoWindow(title: device.displayName),
            icon: BitmapDescriptor.defaultMarkerWithHue(_hueForImei(device.imei)),
            onTap: () => setState(() => _selectedImei = device.imei),
          ),
    };
  }

  Set<Circle> _circles() {
    return {
      for (final zone in _geofences)
        if (zone.active && (zone.lat != 0 || zone.lng != 0))
          Circle(
            circleId: CircleId(zone.id),
            center: LatLng(zone.lat, zone.lng),
            radius: zone.radiusMeters,
            fillColor: GuardianColors.safe.withValues(alpha: 0.12),
            strokeColor: GuardianColors.safe,
            strokeWidth: 2,
          ),
    };
  }

  Future<void> _sendHelp(Device device) async {
    setState(() => _sendingHelp = true);
    try {
      await AlertService().sendHelpAlert(
        imei: device.imei,
        deviceName: device.displayName,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Help alert sent')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not send alert: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _sendingHelp = false);
    }
  }

  Future<void> _rename(Device device) async {
    final ctrl = TextEditingController(text: device.name ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename device'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Friendly name',
            hintText: "e.g. Mum's pendant",
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok == true && mounted) {
      await DeviceService().renameDevice(device.imei, ctrl.text);
    }
    ctrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    final user = FirebaseAuth.instance.currentUser;
    final userInitials = initialsFor(
      user?.displayName?.trim().isNotEmpty == true
          ? user!.displayName!
          : (user?.email ?? 'G'),
    );
    final center = selected?.location?.isValid == true
        ? LatLng(selected!.location!.lat, selected.location!.lng)
        : _mauritius;

    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
              child: Row(
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: GuardianColors.safe,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(Icons.shield, color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Guardian',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  const Spacer(),
                  AvatarBubble(
                    initials: userInitials,
                    color: GuardianColors.safe,
                    size: 32,
                    ringWidth: 0,
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Stack(
                    children: [
                      GoogleMap(
                        initialCameraPosition: CameraPosition(target: center, zoom: _zoom),
                        markers: _markers(),
                        circles: _circles(),
                        myLocationButtonEnabled: true,
                        myLocationEnabled: false,
                        zoomControlsEnabled: true,
                        mapToolbarEnabled: false,
                        compassEnabled: false,
                        indoorViewEnabled: false,
                        trafficEnabled: false,
                        buildingsEnabled: true,
                        onMapCreated: (controller) {
                          _mapController = controller;
                          _fitIfNeeded(_devices);
                        },
                        onCameraMove: (pos) => _zoom = pos.zoom,
                      ),
                      if (_loading)
                        const Center(child: CircularProgressIndicator()),
                      if (_error != null)
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(_error!, textAlign: TextAlign.center),
                          ),
                        ),
                      if (!_loading && _error == null && _devices.isEmpty)
                        const Center(
                          child: Text('No devices yet — run the gateway simulator.'),
                        ),
                      Positioned(
                        top: 14,
                        left: 14,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.place_outlined,
                                size: 13,
                                color: GuardianColors.safeText,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                selected?.online == true ? 'Live tracking' : 'Mauritius',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: GuardianColors.safeText,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_devices.isNotEmpty)
              SizedBox(
                height: 64,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: _devices.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, i) {
                    final d = _devices[i];
                    final selectedChip = d.imei == _selectedImei;
                    final color = avatarColorForKey(d.imei);
                    final label = d.name?.trim().isNotEmpty == true
                        ? d.name!.trim()
                        : 'Device …${d.imei.length > 4 ? d.imei.substring(d.imei.length - 4) : d.imei}';
                    return InkWell(
                      onTap: () {
                        setState(() => _selectedImei = d.imei);
                        if (d.location?.isValid == true) {
                          _animateTo(
                            LatLng(d.location!.lat, d.location!.lng),
                            zoom: 15,
                          );
                        }
                      },
                      onLongPress: () => _rename(d),
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: GuardianColors.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: selectedChip ? color : GuardianColors.border,
                            width: selectedChip ? 1.5 : 1,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AvatarBubble(
                              initials: initialsFor(d.displayName),
                              color: color,
                              size: 26,
                            ),
                            const SizedBox(width: 8),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  label,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    height: 1.15,
                                  ),
                                ),
                                Text(
                                  d.online ? 'Online' : 'Offline',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    height: 1.15,
                                    color: GuardianColors.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            if (selected != null)
              Container(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
                decoration: const BoxDecoration(
                  color: GuardianColors.surface,
                  border: Border(top: BorderSide(color: GuardianColors.border)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              GestureDetector(
                                onTap: () => _rename(selected),
                                child: Text(
                                  'Pendant · ${selected.displayName}',
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${selected.online ? 'Online' : 'Offline'} · IMEI ${selected.imei}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: GuardianColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        StatusPill(
                          label: selected.online ? 'Safe' : 'Offline',
                          tone: selected.online ? PillTone.safe : PillTone.neutral,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: StatTile(
                            icon: Icons.battery_5_bar,
                            value: selected.batteryPercent != null
                                ? '${selected.batteryPercent}%'
                                : '—',
                            iconColor: GuardianColors.safe,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: StatTile(
                            icon: Icons.speed,
                            value: selected.speedKmh != null
                                ? '${selected.speedKmh} km/h'
                                : '—',
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: StatTile(
                            icon: Icons.satellite_alt,
                            value: (selected.accuracySource ?? '—').toUpperCase(),
                            iconColor: GuardianColors.accent,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GuardianColors.danger,
                        ),
                        onPressed: _sendingHelp ? null : () => _sendHelp(selected),
                        icon: const Icon(Icons.warning_amber_rounded, size: 18),
                        label: Text(_sendingHelp ? 'Sending…' : 'Send help alert'),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

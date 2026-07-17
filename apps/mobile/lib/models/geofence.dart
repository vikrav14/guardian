import 'package:cloud_firestore/cloud_firestore.dart';

class Geofence {
  const Geofence({
    required this.id,
    required this.imei,
    required this.name,
    required this.active,
    required this.lat,
    required this.lng,
    required this.radiusMeters,
    this.wifiSsid,
    this.createdBy,
  });

  final String id;
  final String imei;
  final String name;
  final bool active;
  final double lat;
  final double lng;
  final double radiusMeters;
  final String? wifiSsid;
  final String? createdBy;

  factory Geofence.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final center = data['center'] is Map
        ? Map<String, dynamic>.from(data['center'] as Map)
        : <String, dynamic>{};
    return Geofence(
      id: doc.id,
      imei: (data['imei'] as String?) ?? '',
      name: (data['name'] as String?) ?? 'Safe zone',
      active: data['active'] != false,
      lat: (center['lat'] as num?)?.toDouble() ?? 0,
      lng: (center['lng'] as num?)?.toDouble() ?? 0,
      radiusMeters: (data['radiusMeters'] as num?)?.toDouble() ?? 150,
      wifiSsid: data['wifiSsid'] as String?,
      createdBy: data['createdBy'] as String?,
    );
  }
}

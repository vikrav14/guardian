import 'package:cloud_firestore/cloud_firestore.dart';

/// Backend-owned presentation evidence, separate from satellite/network fixes.
class HomeWifiPresence {
  const HomeWifiPresence({
    required this.lat,
    required this.lng,
    required this.observedAt,
    required this.expiresAt,
  });

  final double lat;
  final double lng;
  final DateTime observedAt;
  final DateTime expiresAt;

  bool isFreshAt(DateTime now) =>
      !observedAt.isAfter(now) &&
      expiresAt.isAfter(now) &&
      expiresAt.isAfter(observedAt) &&
      expiresAt.difference(observedAt) <= const Duration(minutes: 2);

  static HomeWifiPresence? fromMap(Map<String, dynamic>? map) {
    if (map == null ||
        map['version'] != 1 ||
        map['policy'] != 'enrolled_home_radio_v1' ||
        map['pilot'] != true ||
        map['state'] != 'matched' ||
        map['source'] != 'home_wifi') {
      return null;
    }
    final anchor = map['anchor'];
    if (anchor is! Map ||
        anchor['geofenceId'] is! String ||
        (anchor['geofenceId'] as String).isEmpty ||
        anchor['lat'] is! num ||
        anchor['lng'] is! num) {
      return null;
    }
    final lat = (anchor['lat'] as num).toDouble();
    final lng = (anchor['lng'] as num).toDouble();
    final observed = _date(map['observedAt']);
    final expiry = _date(map['expiresAt']);
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180 ||
        (lat == 0 && lng == 0) || observed == null || expiry == null) {
      return null;
    }
    return HomeWifiPresence(lat: lat, lng: lng, observedAt: observed, expiresAt: expiry);
  }

  static DateTime? _date(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}

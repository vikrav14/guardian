import 'dart:math' as math;

import 'package:cloud_firestore/cloud_firestore.dart';

/// Backend-owned presentation evidence, separate from satellite/network fixes.
class HomeWifiPresence {
  const HomeWifiPresence({
    required this.lat,
    required this.lng,
    required this.observedAt,
    required this.expiresAt,
    this.policyVersion = 1,
    this.radiusMeters,
  });

  final double lat;
  final double lng;
  final DateTime observedAt;
  final DateTime expiresAt;
  final int policyVersion;
  final double? radiusMeters;

  /// Presentation guard, not a measured accuracy claim. Keep in contract with
  /// gateway/src/wifi-home-gps-policy.js and the shared display fixtures.
  bool gpsAgreesWithHome(double gpsLat, double gpsLng, double? accuracyMeters) {
    final radius = radiusMeters;
    if (radius == null || !radius.isFinite || radius <= 0 ||
        !gpsLat.isFinite || !gpsLng.isFinite || gpsLat.abs() > 90 ||
        gpsLng.abs() > 180 || (gpsLat == 0 && gpsLng == 0) ||
        (accuracyMeters != null && (!accuracyMeters.isFinite || accuracyMeters <= 0))) {
      return false;
    }
    double radians(double degrees) => degrees * math.pi / 180;
    final term = math.pow(math.sin(radians(gpsLat - lat) / 2), 2) +
        math.cos(radians(lat)) * math.cos(radians(gpsLat)) *
        math.pow(math.sin(radians(gpsLng - lng) / 2), 2);
    final distance = 6371000 * 2 * math.asin(math.sqrt(term.clamp(0, 1)));
    final margin = math.max(30.0, accuracyMeters ?? 30.0);
    return distance + margin <= math.min(radius, 150.0);
  }

  bool isFreshAt(DateTime now) =>
      !observedAt.isAfter(now) &&
      expiresAt.isAfter(now) &&
      expiresAt.isAfter(observedAt) &&
      expiresAt.difference(observedAt) <= const Duration(minutes: 2);

  static HomeWifiPresence? fromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    final legacy = map['version'] == 1 && map['policy'] == 'enrolled_home_radio_v1';
    final current = map['version'] == 2 && map['policy'] == 'enrolled_home_radio_v2';
    if ((!legacy && !current) ||
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
    final rawRadius = anchor['radiusMeters'];
    final radius = rawRadius is num ? rawRadius.toDouble() : null;
    if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180 ||
        (lat == 0 && lng == 0) || observed == null || expiry == null ||
        (current && (radius == null || !radius.isFinite || radius <= 0))) {
      return null;
    }
    return HomeWifiPresence(lat: lat, lng: lng, observedAt: observed, expiresAt: expiry,
      policyVersion: current ? 2 : 1, radiusMeters: current ? radius : null);
  }

  static DateTime? _date(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}

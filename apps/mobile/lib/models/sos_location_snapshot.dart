import 'package:cloud_firestore/cloud_firestore.dart';

/// Read-only interpretation of the backend-owned physical SOS evidence.
///
/// Keep this reader aligned with gateway/src/sos-location-snapshot.js.
/// Never construct incident coordinates from a later Device read or payload.
class SosLocationSnapshot {
  const SosLocationSnapshot._({
    required this.capturedAt,
    required this.state,
    required this.retainedSatellite,
    required this.location,
    required this.latestObservation,
    required this.ageSeconds,
  });

  final DateTime capturedAt;
  final String state;
  final bool retainedSatellite;
  final SosLocationPoint? location;
  final SosLocationPoint? latestObservation;
  final int? ageSeconds;

  static SosLocationSnapshot? tryParse(Object? value) {
    if (value is! Map ||
        value['version'] != 1 ||
        value['policy'] != 'map_retained_satellite_v1' ||
        !const {
          'fresh',
          'last_known',
          'unavailable',
        }.contains(value['state'])) {
      return null;
    }
    final capturedAt = _date(value['capturedAt']);
    if (capturedAt == null) return null;
    final location = SosLocationPoint._parse(value['location'], capturedAt);
    if (value['state'] != 'unavailable' && location == null) return null;
    if (value['state'] == 'unavailable' && value['location'] != null) {
      return null;
    }
    final retained =
        value['retainedSatellite'] == true && location?.source == 'gps';
    final age = location?.ageAt(capturedAt);
    final state = location == null
        ? 'unavailable'
        : retained || location.source == null || age == null || age > 600
        ? 'last_known'
        : 'fresh';
    if (state != value['state']) return null;
    return SosLocationSnapshot._(
      capturedAt: capturedAt,
      state: state,
      retainedSatellite: retained,
      location: location,
      latestObservation: SosLocationPoint._parse(
        value['latestObservation'],
        capturedAt,
      ),
      ageSeconds: age,
    );
  }

  Uri? get mapsUri {
    final point = location;
    if (point == null || state == 'unavailable') return null;
    return Uri.https('maps.google.com', '/', {
      'q': '${point.lat},${point.lng}',
    });
  }

  SosLocationPoint? get secondaryNetworkObservation {
    final point = latestObservation;
    return retainedSatellite &&
            point != null &&
            const {'wifi', 'lbs'}.contains(point.source)
        ? point
        : null;
  }
}

class SosLocationPoint {
  const SosLocationPoint._({
    required this.lat,
    required this.lng,
    required this.source,
    required this.recordedAt,
    required this.placeLabel,
    required this.accuracyMeters,
  });

  final double lat;
  final double lng;
  final String? source;
  final DateTime? recordedAt;
  final String? placeLabel;
  final double? accuracyMeters;

  int? ageAt(DateTime receipt) {
    final recorded = recordedAt;
    if (recorded == null) return null;
    return (receipt.difference(recorded).inMilliseconds / 1000).round();
  }

  static SosLocationPoint? _parse(Object? value, DateTime capturedAt) {
    if (value is! Map) return null;
    final lat = _finite(value['lat']);
    final lng = _finite(value['lng']);
    if (lat == null ||
        lng == null ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        (lat == 0 && lng == 0)) {
      return null;
    }
    final rawSource = value['source']?.toString().trim().toLowerCase();
    final source = const {'gps', 'wifi', 'lbs'}.contains(rawSource)
        ? rawSource
        : null;
    if (source == 'gps' && value['gpsValid'] == false) return null;
    final recordedAt = _date(value['recordedAt']);
    if (recordedAt != null && recordedAt.isAfter(capturedAt)) return null;
    final accuracy = _finite(value['accuracyMeters']);
    final place = value['placeLabel']?.toString().trim();
    return SosLocationPoint._(
      lat: lat,
      lng: lng,
      source: source,
      recordedAt: recordedAt,
      placeLabel: place == null || place.isEmpty ? null : place,
      accuracyMeters: source == 'gps' || accuracy == null || accuracy < 0
          ? null
          : accuracy,
    );
  }
}

double? _finite(Object? value) {
  final number = value is num
      ? value.toDouble()
      : value is String
      ? double.tryParse(value.trim())
      : null;
  return number != null && number.isFinite ? number : null;
}

DateTime? _date(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

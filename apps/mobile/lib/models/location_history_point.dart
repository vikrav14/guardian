import 'package:cloud_firestore/cloud_firestore.dart';

class LocationHistoryPoint {
  const LocationHistoryPoint({
    required this.lat,
    required this.lng,
    this.speedKmh,
    this.accuracySource,
    this.source,
    this.gpsValid,
    this.accuracyMeters,
    this.satellites,
    this.recordedAt,
    this.sourcePointIndex,
  });

  final double lat;
  final double lng;
  final num? speedKmh;
  final String? accuracySource;
  final String? source;
  final bool? gpsValid;
  final double? accuracyMeters;
  final int? satellites;
  final DateTime? recordedAt;
  final int? sourcePointIndex;

  factory LocationHistoryPoint.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? <String, dynamic>{};
    return LocationHistoryPoint(
      lat: (data['lat'] as num?)?.toDouble() ?? 0,
      lng: (data['lng'] as num?)?.toDouble() ?? 0,
      speedKmh: data['speedKmh'] as num?,
      accuracySource: data['accuracySource'] as String?,
      source: data['source'] as String?,
      gpsValid: data['gpsValid'] as bool?,
      accuracyMeters: (data['accuracyMeters'] as num?)?.toDouble(),
      satellites: (data['satellites'] as num?)?.toInt(),
      recordedAt: _asDateTime(data['recordedAt']),
      sourcePointIndex: (data['sourcePointIndex'] as num?)?.toInt(),
    );
  }
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

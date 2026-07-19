import 'package:cloud_firestore/cloud_firestore.dart';

class LocationHistoryPoint {
  const LocationHistoryPoint({
    required this.lat,
    required this.lng,
    this.speedKmh,
    this.accuracySource,
    this.recordedAt,
  });

  final double lat;
  final double lng;
  final num? speedKmh;
  final String? accuracySource;
  final DateTime? recordedAt;

  factory LocationHistoryPoint.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return LocationHistoryPoint(
      lat: (data['lat'] as num?)?.toDouble() ?? 0,
      lng: (data['lng'] as num?)?.toDouble() ?? 0,
      speedKmh: data['speedKmh'] as num?,
      accuracySource: data['accuracySource'] as String?,
      recordedAt: _asDateTime(data['recordedAt']),
    );
  }
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

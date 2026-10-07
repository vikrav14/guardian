import '../models/device.dart';

DateTime? _time(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;
String _text(Object? value, [int max = 300]) =>
    value is String && value.length <= max ? value.trim() : '';

class PriorityUpdate {
  PriorityUpdate(Map<String, dynamic> map)
    : id = _text(map['id']),
      revision = _text(map['revision']),
      title = _text(map['title']),
      kind = _text(map['kind']),
      eventType = _text(map['eventType']),
      place = _text(map['placeName']),
      source = _text(map['sourceName']),
      reason = _text(map['matchReason'], 600),
      publishedAt = _time(map['publishedAt']),
      checkedAt = _time(map['sourceCheckedAt']),
      expiresAt = _time(map['expiresAt']),
      uri = Uri.tryParse(_text(map['sourceUrl'], 2000));

  final String id, revision, title, kind, eventType, place, source, reason;
  final DateTime? publishedAt, checkedAt, expiresAt;
  final Uri? uri;
  bool get official => kind == 'official_warning';
  bool isCurrent(DateTime now) {
    final allowedHosts = official
        ? {'cap-sources.s3.amazonaws.com', 'metservice.intnet.mu'}
        : {'defimedia.info', 'www.defimedia.info'};
    return {'official_warning', 'local_report'}.contains(kind) &&
        id.isNotEmpty &&
        title.isNotEmpty &&
        source.isNotEmpty &&
        reason.isNotEmpty &&
        expiresAt != null &&
        now.isBefore(expiresAt!) &&
        publishedAt != null &&
        checkedAt != null &&
        !publishedAt!.isAfter(now.add(const Duration(minutes: 1))) &&
        !checkedAt!.isAfter(now.add(const Duration(minutes: 1))) &&
        now.difference(checkedAt!) < Duration(minutes: official ? 10 : 30) &&
        uri?.scheme == 'https' &&
        allowedHosts.contains(uri?.host) &&
        uri!.userInfo.isEmpty &&
        (!uri!.hasPort || uri!.port == 443);
  }
}

/// Source freshness, location age and Family access are independent checks.
class PriorityUpdates {
  PriorityUpdates.fromMap(Map<String, dynamic> map)
    : valid = map['schemaVersion'] == 1,
      location = map['location'] is Map
          ? Map<String, dynamic>.from(map['location'] as Map)
          : const {},
      items = map['items'] is List
          ? (map['items'] as List)
                .whereType<Map>()
                .take(5)
                .map(
                  (value) => PriorityUpdate(Map<String, dynamic>.from(value)),
                )
                .toList()
          : const [];
  final bool valid;
  final Map<String, dynamic> location;
  final List<PriorityUpdate> items;
  DateTime? get observedAt => _time(location['recordedAt']);
  DateTime? get locationExpiry => _time(location['expiresAt']);

  List<PriorityUpdate> applicable(Device device, DateTime now) {
    if (!valid ||
        !device.allowsShared('location') ||
        device.homeWifiConflictAt(now) ||
        observedAt == null ||
        locationExpiry == null ||
        !now.isBefore(locationExpiry!) ||
        now.difference(observedAt!) >= const Duration(minutes: 15) ||
        observedAt!.isAfter(now.add(const Duration(minutes: 1)))) {
      return const [];
    }
    final home = device.homeWifiLocationAt(now);
    final fix = home ?? device.lastLocationObservation ?? device.location;
    if (fix == null || fix.recordedAt == null || !fix.isValid) return const [];
    final source = home != null
        ? 'home_wifi'
        : fix.gpsValid == true || (fix.source ?? device.accuracySource) == 'gps'
        ? 'gps'
        : fix.source ?? device.accuracySource;
    final remembered = home == null
        ? device.rememberedHomeWifiLocationAt(now)
        : null;
    if (remembered?.recordedAt != null &&
        !remembered!.recordedAt!.isBefore(fix.recordedAt!)) {
      return const [];
    }
    if (source != location['source'] ||
        fix.lat != location['lat'] ||
        fix.lng != location['lng'] ||
        !fix.recordedAt!.isAtSameMomentAs(observedAt!)) {
      return const [];
    }
    if (!{'gps', 'wifi', 'lbs', 'home_wifi'}.contains(source)) return const [];
    if ({'wifi', 'lbs'}.contains(source) &&
        (fix.accuracyMeters == null ||
            fix.accuracyMeters! <= 0 ||
            fix.accuracyMeters! > 1000)) {
      return const [];
    }
    return items.where((item) => item.isCurrent(now)).toList();
  }
}

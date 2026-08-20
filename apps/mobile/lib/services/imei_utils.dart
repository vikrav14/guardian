const _imeiPrefix = '8613970';
const _imeiDefaultSuffix = '0';

String _digitsOnly(String value) => value.replaceAll(RegExp(r'\D'), '');

/// ReachFar V52 protocol-ID normalization — mirrors gateway/src/imei.js.
///
/// Protocol frames use a 10-digit id; Firestore `linkedImeis` and device
/// document ids should always use the 15-digit label/SMS IMEI.
bool isProtocolId(String value) {
  final id = _digitsOnly(value);
  return id.length == 10 && RegExp(r'^\d+$').hasMatch(id);
}

bool isFullImei(String value) {
  final id = _digitsOnly(value);
  return id.length == 15 && RegExp(r'^\d+$').hasMatch(id);
}

String? fullImeiFromProtocolId(String protocolId) {
  final id = _digitsOnly(protocolId);
  if (!isProtocolId(id)) return null;
  if (!id.startsWith('970')) return null;

  final core = _imeiPrefix + id.substring(3);
  if (core.length != 14) return null;
  return core + _imeiDefaultSuffix;
}

/// Canonical 15-digit Firestore document id for any linked entry.
String? canonicalDeviceImei(String raw) {
  final id = _digitsOnly(raw);
  if (id.isEmpty) return null;
  if (isFullImei(id)) return id;
  if (isProtocolId(id)) return fullImeiFromProtocolId(id) ?? id;
  return id;
}

/// Normalizes and deduplicates guardian `linkedImeis` for Firestore queries.
///
/// 10-digit protocol ids expand to 15-digit docs; other ids pass through so
/// tests and legacy entries still resolve.
List<String> normalizeLinkedImeis(Iterable<String> raw) {
  final canonical = <String>{};
  for (final entry in raw) {
    final trimmed = entry.trim();
    if (trimmed.isEmpty) continue;

    final digits = _digitsOnly(trimmed);
    if (digits.isEmpty) {
      canonical.add(trimmed);
      continue;
    }
    if (isFullImei(digits)) {
      canonical.add(digits);
      continue;
    }
    if (isProtocolId(digits)) {
      canonical.add(fullImeiFromProtocolId(digits) ?? digits);
      continue;
    }
    canonical.add(digits);
  }
  final sorted = canonical.toList()..sort();
  return sorted;
}

bool linkedImeisEqual(List<String> a, List<String> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

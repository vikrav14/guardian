final _nearSeparator = RegExp(r'\s*·\s*near\s*', caseSensitive: false);

String? _placePart(String value) {
  final clean = value.trim().replaceAll(RegExp(r'\s+'), ' ');
  final meaningful = clean.replaceAll(
    RegExp(r'[^\p{L}\p{N}]', unicode: true),
    '',
  );
  return meaningful.runes.length >= 2 &&
          RegExp(r'\p{L}', unicode: true).hasMatch(clean)
      ? clean
      : null;
}

/// Old geocoder results can contain a single letter as the nearest road or
/// premise. Keep the known area, without inventing the missing road name.
String? displayPlaceLabel(String? value) {
  if (value == null) return null;
  final parts = value.split(_nearSeparator);
  final area = _placePart(parts.first);
  if (parts.length == 1) return area;
  final detail = _placePart(parts.skip(1).join(' · near '));
  if (detail == null || detail.toLowerCase() == area?.toLowerCase()) {
    return area;
  }
  return area == null ? 'Near $detail' : '$area · near $detail';
}

/// Weather describes an area, so it does not need a nearby street or premise.
String? weatherAreaLabel(String? value) {
  final label = displayPlaceLabel(value);
  if (label == null) return null;
  return _placePart(
    label
        .split(_nearSeparator)
        .first
        .replaceFirst(RegExp(r'^near\s+', caseSensitive: false), ''),
  );
}

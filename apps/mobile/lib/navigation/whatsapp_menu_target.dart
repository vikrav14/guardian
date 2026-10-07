import '../services/family_sharing_service.dart';

/// Navigation only: a link contains no watch identifier or access grant.
class WhatsAppMenuTarget {
  const WhatsAppMenuTarget(this.screen, this.wearerKey);
  final String screen, wearerKey;
  static const screens = {
    'today',
    'updates',
    'location',
    'journey',
    'alerts',
    'photos',
    'watch',
    'settings',
    'reminders',
    'wellness',
    'routine',
    'movement',
    'call',
    'voice',
    'zones',
    'family',
    'account',
    'help',
  };
  static WhatsAppMenuTarget? fromUri(Uri uri) {
    if (uri.queryParameters.containsKey('guardianScreen') ||
        uri.queryParameters.containsKey('guardianWearer')) {
      final values = uri.queryParametersAll;
      final screen = values['guardianScreen'], key = values['guardianWearer'];
      if (screen?.length != 1 ||
          key?.length != 1 ||
          !screens.contains(screen!.single) ||
          !RegExp(r'^[a-f0-9]{20}$').hasMatch(key!.single)) {
        return null;
      }
      return WhatsAppMenuTarget(screen.single, key.single);
    }
    final fragment = Uri.tryParse(uri.fragment);
    if (fragment == null ||
        fragment.path != '/menu' ||
        fragment.hasFragment ||
        fragment.queryParametersAll.length != 2 ||
        fragment.queryParametersAll.values.any(
          (values) => values.length != 1,
        )) {
      return null;
    }
    final screen = fragment.queryParameters['screen'];
    final key = fragment.queryParameters['wearer'];
    if (!screens.contains(screen) ||
        key == null ||
        !RegExp(r'^[a-f0-9]{20}$').hasMatch(key)) {
      return null;
    }
    return WhatsAppMenuTarget(screen!, key);
  }

  FamilyCircle? resolve(FamilySharingSnapshot snapshot) {
    final matches = snapshot.circles.where(
      (circle) =>
          circle.data['menuKey'] == wearerKey &&
          (circle.data['menuScreens'] as List?)?.contains(screen) == true,
    );
    return matches.length == 1 ? matches.single : null;
  }
}

import 'package:flutter/foundation.dart';

/// Public build-time configuration for Guardian's business WhatsApp number.
///
/// Supply digits in international format, without a leading `+`, for example:
/// `--dart-define=GUARDIAN_WHATSAPP_NUMBER=2301234567`.
const String guardianWhatsAppNumber = String.fromEnvironment(
  'GUARDIAN_WHATSAPP_NUMBER',
);

String normalizeGuardianPhoneNumber(String value) {
  return value.replaceAll(RegExp(r'\D'), '');
}

String? configuredGuardianWhatsAppNumber([
  String value = guardianWhatsAppNumber,
]) {
  final normalized = normalizeGuardianPhoneNumber(value);
  return normalized.isEmpty ? null : normalized;
}

Uri guardianWhatsAppMobileUri({
  required String number,
  required String message,
}) {
  return Uri.https('wa.me', '/${normalizeGuardianPhoneNumber(number)}', {
    'text': message,
  });
}

Uri guardianWhatsAppWebUri({required String number, required String message}) {
  return Uri.https('web.whatsapp.com', '/send', {
    'phone': normalizeGuardianPhoneNumber(number),
    'text': message,
  });
}

bool get isMobileGuardianPlatform {
  return defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS;
}

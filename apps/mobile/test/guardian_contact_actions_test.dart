import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_contact_actions.dart';

void main() {
  test('Guardian phone normalization removes display punctuation', () {
    expect(normalizeGuardianPhoneNumber('+230 5859-0100'), '23058590100');
    expect(configuredGuardianWhatsAppNumber(''), isNull);
    expect(
      configuredGuardianWhatsAppNumber('+1 (555) 197-7150'),
      '15551977150',
    );
  });

  test('mobile WhatsApp URI contains approved number and message', () {
    final uri = guardianWhatsAppMobileUri(
      number: '+230 5859 0100',
      message: 'Hi Guardian, help with Jesh.',
    );

    expect(uri.host, 'wa.me');
    expect(uri.path, '/23058590100');
    expect(uri.queryParameters['text'], 'Hi Guardian, help with Jesh.');
  });

  test('desktop WhatsApp URI targets Web without changing message', () {
    final uri = guardianWhatsAppWebUri(
      number: '23058590100',
      message: 'Hi Guardian',
    );

    expect(uri.host, 'web.whatsapp.com');
    expect(uri.path, '/send');
    expect(uri.queryParameters['phone'], '23058590100');
    expect(uri.queryParameters['text'], 'Hi Guardian');
  });
}

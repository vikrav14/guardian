import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/imei_utils.dart';

void main() {
  test('fullImeiFromProtocolId maps ReachFar V28C ids with default suffix', () {
    expect(fullImeiFromProtocolId('9705314117'), '861397053141170');
  });

  test('normalizeLinkedImeis dedupes protocol id and full IMEI', () {
    expect(
      normalizeLinkedImeis(['9705314117', '861397053141170']),
      ['861397053141170'],
    );
  });

  test('normalizeLinkedImeis keeps non-numeric test ids', () {
    expect(normalizeLinkedImeis(['AAA', '9705314117']), [
      '861397053141170',
      'AAA',
    ]);
  });
}

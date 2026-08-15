import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/imei_utils.dart';

void main() {
  test('fullImeiFromProtocolId maps ReachFar V52 ids with default suffix', () {
    expect(fullImeiFromProtocolId('9705254740'), '861397052547400');
  });

  test('normalizeLinkedImeis dedupes protocol id and full IMEI', () {
    expect(normalizeLinkedImeis(['9705254740', '861397052547400']), [
      '861397052547400',
    ]);
  });

  test('normalizeLinkedImeis keeps non-numeric test ids', () {
    expect(normalizeLinkedImeis(['AAA', '9705254740']), [
      '861397052547400',
      'AAA',
    ]);
  });
}

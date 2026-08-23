import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/removal_alert_state.dart';

void main() {
  test('unverified removal evidence fails closed for customers', () {
    final state = RemovalAlertState.fromMap({
      'state': 'removed',
      'displayable': false,
      'mode': 'unverified',
    });

    expect(state.state, WatchRemovalState.removed);
    expect(state.customerSafe, isFalse);
  });

  test('only accepted displayable state is customer safe', () {
    final state = RemovalAlertState.fromMap({
      'state': 'worn',
      'displayable': true,
      'mode': 'accepted',
    });

    expect(state.state, WatchRemovalState.worn);
    expect(state.customerSafe, isTrue);
  });
}

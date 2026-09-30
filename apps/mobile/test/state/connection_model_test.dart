import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/state/connection_model.dart';

void main() {
  test('starts connecting, flips online on open, reconnecting on drop', () {
    final conn = ConnectionModel();
    expect(conn.state, 'connecting');

    conn.opened();
    expect(conn.state, 'online');

    conn.dropped();
    expect(conn.state, 'reconnecting');

    conn.opened();
    expect(conn.state, 'online');
  });

  test('a drop before the first open still reports reconnecting', () {
    final conn = ConnectionModel();
    conn.dropped();
    expect(conn.state, 'reconnecting');
  });

  test('state changes notify listeners', () {
    final conn = ConnectionModel();
    var notified = 0;
    conn.addListener(() => notified++);
    conn.opened();
    conn.dropped();
    expect(notified, 2);
  });
}

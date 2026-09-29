import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/lib/post_events.dart';

void main() {
  test('error events surface their message', () {
    expect(postEventError({'type': 'error', 'message': 'boom'}), 'boom');
  });

  test('non-error events return null', () {
    expect(postEventError({'type': 'started'}), isNull);
    expect(postEventError({'type': 'done'}), isNull);
  });
}

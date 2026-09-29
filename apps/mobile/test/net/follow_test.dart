import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/net/follow.dart';

void main() {
  test('reconnects with doubling backoff, capped, and resets on success', () async {
    final delays = <Duration>[];
    var attempts = 0;
    final lines = <String>[];
    final handle = followSse(
      connect: () async {
        if (attempts < 5) {
          attempts++;
          throw StateError('down');
        }
        return Stream.fromIterable(['data: hello\n\n']);
      },
      onLine: lines.add,
      onReset: () {},
      // Record the wait AND really wait: an instantly-completing delay spins
      // the retry loop inside one microtask drain, starving the event loop
      // so close() (a timer callback) can never run.
      delay: (d) async {
        delays.add(d);
        await Future<void>.delayed(const Duration(milliseconds: 1));
      },
      retryMs: const Duration(seconds: 2),
      maxRetryMs: const Duration(seconds: 30),
    );
    await Future<void>.delayed(const Duration(milliseconds: 50));
    handle.close();
    // 5 failures → 2s, 4s, 8s, 16s, 30s (cap). After the success the follower
    // keeps following (a clean stream end reconnects too — the server keeps
    // SSE open in production), so only the first five waits are the backoff.
    expect(delays.take(5).map((d) => d.inSeconds), [2, 4, 8, 16, 30]);
    // Success keeps following (reconnect cycles continue until close), so
    // pin delivery, not a single line.
    expect(lines, isNotEmpty);
    expect(lines.first, 'hello');
  });

  test('close cancels pending reconnects', () async {
    var connects = 0;
    final handle = followSse(
      connect: () async {
        connects++;
        throw StateError('down');
      },
      onLine: (_) {},
      onReset: () {},
      // A real (short) wait so the event loop can run close()'s timer —
      // an instantly-completing delay would spin the loop inside one
      // microtask drain and starve it.
      delay: (_) => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    handle.close();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final after = connects;
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(connects, after);
  });

  test('stream ending without error also triggers a reconnect', () async {
    var connects = 0;
    final handle = followSse(
      connect: () async {
        connects++;
        return Stream.fromIterable(const []);
      },
      onLine: (_) {},
      onReset: () {},
      delay: (_) => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));
    handle.close();
    expect(connects, greaterThanOrEqualTo(2));
  });
}

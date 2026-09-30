// Owns SSE reconnection (port of pwa sse-follow.ts): exponential backoff
// with a cap, onReset() on every drop, and a close() that stops the loop.
// Pacing goes through the injected `delay` seam — production passes
// `(d) => Future.delayed(d)`, tests record the waits — so the loop checks
// `closed` after every await point and never reconnects once closed.
//
// Framing: the connected stream is a raw byte-chunk stream, and chunks land
// at arbitrary offsets — a `data: ...\n\n` frame is almost never aligned
// with one chunk. parseSse (SseFrameSplitter) buffers and reassembles, so
// onLine receives complete, `data: `-stripped payloads only. Comment frames
// (keepalives, the stream-open marker) carry no data and are skipped.
import 'dart:async';

import 'package:ccferry_mobile/net/sse.dart';

class FollowHandle {
  FollowHandle(this._close);
  final void Function() _close;

  void close() => _close();
}

FollowHandle followSse({
  required Future<Stream<String>> Function() connect,
  required void Function(String data) onLine,
  required void Function() onReset,
  required Future<void> Function(Duration d) delay,
  Duration retryMs = const Duration(seconds: 2),
  Duration maxRetryMs = const Duration(seconds: 30),
}) {
  var attempt = 0;
  var closed = false;
  StreamSubscription<void>? sub;

  Future<void> run() async {
    while (!closed) {
      try {
        final stream = await connect();
        attempt = 0; // healthy again — next drop retries fast
        final completer = Completer<void>();
        sub = parseSse(stream).listen(
          (payload) {
            if (payload.isNotEmpty) onLine(payload);
          },
          onDone: () => completer.complete(),
          onError: (Object _) => completer.complete(),
          cancelOnError: true,
        );
        await completer.future;
      } catch (_) {
        // connect() itself failed — fall through to the backoff path
      }
      if (closed) return;
      onReset();
      final raw = retryMs * (1 << attempt.clamp(0, 30));
      final wait = raw > maxRetryMs ? maxRetryMs : raw;
      attempt += 1;
      await delay(wait);
    }
  }

  unawaited(run());
  return FollowHandle(() {
    closed = true;
    unawaited(sub?.cancel());
  });
}

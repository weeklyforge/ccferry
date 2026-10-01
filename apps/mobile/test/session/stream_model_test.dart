import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/session/bubbles.dart';
import 'package:ccferry_mobile/session/stream_model.dart';

// Fake SSE source: replays the same lines on every (re)connect.
class FakeSource {
  FakeSource(this.lines);

  final List<String> lines;
  final List<String> paths = <String>[];

  Future<Stream<String>> connect(String path) async {
    paths.add(path);
    return Stream.fromIterable([
      // Lines are already JSON strings — the frame wraps them verbatim.
      for (final l in lines) 'data: $l\n\n',
    ]);
  }

  /// Widget-test mode: emit the lines and stay open (like a live SSE), so the
  /// follower never schedules a reconnect timer — fake_async flags pending
  /// timers at test end.
  Future<Stream<String>> connectOpen(String path) async {
    paths.add(path);
    final controller = StreamController<String>();
    for (final l in lines) {
      controller.add('data: $l\n\n');
    }
    // Never close — the test closes the model, which cancels the stream.
    return controller.stream;
  }

  /// Live mode for interaction tests: unlike connectOpen, the controller
  /// stays reachable so the test can emit lines AFTER the initial batch
  /// (a message arriving while the user is scrolled up).
  StreamController<String>? live;

  Future<Stream<String>> connectLive(String path) async {
    paths.add(path);
    live = StreamController<String>();
    for (final l in lines) {
      live!.add('data: $l\n\n');
    }
    return live!.stream;
  }

  void emit(String line) => live?.add('data: $line\n\n');

  static String userLine(String uuid, String text) =>
      jsonEncode({'uuid': uuid, 'type': 'user', 'message': {'content': text}});

  /// The real wire payload: the daemon wraps each session line in the
  /// packages/protocol ParsedLine envelope.
  static String envelope(String sessionLineJson) =>
      jsonEncode({'ok': true, 'line': 1, 'json': jsonDecode(sessionLineJson)});

  static String resultLine(String toolUseId, String text) => jsonEncode({
        'uuid': 'r-$toolUseId',
        'type': 'user',
        'message': {
          'content': [
            {'type': 'tool_result', 'tool_use_id': toolUseId, 'content': text},
          ],
        },
      });
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 300));

void main() {
  test('dedupe and pairing: one render per line', () async {
    final source = FakeSource([
      FakeSource.userLine('u1', 'hello'),
      FakeSource.resultLine('t1', 'done'),
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);
    model.start(sessionId: 's1');
    await settle();
    model.close();

    // user text line renders one TextBubble; the result-only line renders none
    // (tool_result is not a bubble), but fills toolResults.
    expect(model.bubbles.length, 1);
    expect(model.toolResults['t1']!.text, 'done');
    // Reconnect-following after a clean stream end is pinned by follow_test;
    // not duplicated here (its 2s backoff does not fit a fast test window).
  });

  test('daemon envelope lines render text bubbles', () async {
    // Wire-shape pin: what arrives in onLine is the daemon's ParsedLine
    // envelope, and it must render exactly like a bare session line would.
    final source = FakeSource([FakeSource.envelope(FakeSource.userLine('u1', 'hello'))]);
    final model = SessionStreamModel(connect: source.connectOpen);
    model.start(sessionId: 's1');
    await settle();
    model.close();

    expect(model.bubbles.length, 1);
    expect((model.bubbles.single as TextBubble).text, 'hello');
  });

  test('loadFullHistory reconnects without tail and keeps bubbles', () async {
    final source = FakeSource([
      FakeSource.userLine('u1', 'hello'),
      FakeSource.resultLine('t1', 'done'),
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);
    model.start(sessionId: 's1');
    await settle();
    expect(model.bubbles.length, 1);

    model.loadFullHistory();
    await settle();
    model.close();

    expect(source.paths.last.contains('tailBytes'), isFalse);
    expect(source.paths.first.contains('tailBytes=262144'), isTrue);
    // NOT cleared: the replayed line is absorbed by dedupe, still one bubble.
    expect(model.bubbles.length, 1);
  });

  test('toggle flips expanded state', () async {
    final source = FakeSource([FakeSource.userLine('u1', 'hi')]);
    final model = SessionStreamModel(connect: source.connectOpen);
    model.start(sessionId: 's1');
    await settle();
    model.close();

    expect(model.expanded.contains('t1'), isFalse);
    model.toggle('t1');
    expect(model.expanded.contains('t1'), isTrue);
    model.toggle('t1');
    expect(model.expanded.contains('t1'), isFalse);
  });

  test('beginSend holds a pending message until the matching user line arrives', () async {
    final source = FakeSource([]);
    final model = SessionStreamModel(connect: source.connectLive);
    model.start(sessionId: 's1');
    await settle();

    model.beginSend('hello me');
    expect(model.pendingSend, 'hello me');

    source.emit(FakeSource.userLine('n1', 'hello me'));
    await settle();
    model.close();

    expect(model.pendingSend, isNull);
    // the real line rendered exactly once — no duplicate for the pending
    expect(
      model.bubbles.whereType<TextBubble>().where((b) => b.text == 'hello me').length,
      1,
    );
  });

  test('cancelPendingSend drops the pending message', () async {
    final source = FakeSource([]);
    final model = SessionStreamModel(connect: source.connectLive);
    model.start(sessionId: 's1');
    await settle();

    model.beginSend('doomed');
    model.cancelPendingSend();
    model.close();

    expect(model.pendingSend, isNull);
  });

  test('pending clears even when the echo arrives as a dedupe-replayed line', () async {
    final source = FakeSource([FakeSource.userLine('n1', 'repeat me')]);
    final model = SessionStreamModel(connect: source.connectLive);
    model.start(sessionId: 's1');
    await settle(); // 'repeat me' already seen by dedupe

    model.beginSend('repeat me');
    source.emit(FakeSource.userLine('n1', 'repeat me')); // replay after reconnect
    await settle();
    model.close();

    expect(model.pendingSend, isNull);
  });
}

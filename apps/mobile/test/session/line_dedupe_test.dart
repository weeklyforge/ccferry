import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/line_dedupe.dart';

ParsedLine line(String uuid) => ParsedLine.ok(1, {'uuid': uuid, 'type': 'user'});

void main() {
  test('accepts a line once and skips its replay', () {
    final d = LineDedupe();
    expect(d.firstOf(line('a')), isTrue);
    expect(d.firstOf(line('a')), isFalse); // replayed after reconnect
    expect(d.firstOf(line('b')), isTrue);
  });

  test('falls back to content hash when the line has no uuid', () {
    final d = LineDedupe();
    final noId = ParsedLine.ok(9, {'type': 'user', 'message': 'same'});
    expect(d.firstOf(noId), isTrue);
    expect(d.firstOf(noId), isFalse);
  });

  test('forgets oldest lines beyond the capacity window', () {
    final d = LineDedupe(capacity: 6);
    for (var i = 0; i < 10; i++) {
      d.firstOf(line('k$i'));
    }
    expect(d.firstOf(line('k0')), isTrue); // evicted — accepted again
  });

  test('reset clears everything (explicit full-history reload)', () {
    final d = LineDedupe();
    d.firstOf(line('a'));
    d.reset();
    expect(d.firstOf(line('a')), isTrue);
  });

  test('keys use the documented prefixes', () {
    final d = LineDedupe();
    // json fallback keys hash the first 256 chars of the encoded json
    final a = ParsedLine.ok(1, {'type': 'user'});
    final b = ParsedLine.bad(2, 'raw stuff');
    expect(d.firstOf(a), isTrue);
    expect(d.firstOf(b), isTrue);
    expect(d.firstOf(a), isFalse);
    expect(d.firstOf(b), isFalse);
    expect(jsonEncode(a.json).length, greaterThan(0));
  });
}

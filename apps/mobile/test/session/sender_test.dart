import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/session/sender.dart';

void main() {
  test('send posts the text and collects error events', () async {
    final bodies = <Map<String, dynamic>>[];
    final client = ApiClient(
      client: MockClient((r) async {
        bodies.add(jsonDecode((r).body) as Map<String, dynamic>);
        return http.Response('data: {"type":"error","message":"nope"}\n\n', 200);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi');

    expect(bodies.single, {'text': 'hi'});
    expect(sender.errors, ['nope']);
  });

  test('autoMode rides the request as mode auto', () async {
    final bodies = <Map<String, dynamic>>[];
    final client = ApiClient(
      client: MockClient((r) async {
        bodies.add(jsonDecode((r).body) as Map<String, dynamic>);
        return http.Response('data: {"type":"done"}\n\n', 200);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi', autoMode: true);

    expect(bodies.single, {'text': 'hi', 'mode': 'auto'});
    expect(sender.errors, isEmpty);
  });

  test('409 session_active surfaces a friendly hint and never retries', () async {
    var posts = 0;
    final client = ApiClient(
      client: MockClient((r) async {
        posts += 1;
        return http.Response(jsonEncode({'error': 'session_active'}), 409);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi');

    expect(posts, 1); // the guard is absolute — no force retry
    expect(sender.errors, ['会话正在 PC 端使用，请稍后再试']);
  });

  test('other errors surface as messages', () async {
    final client = ApiClient(
      client: MockClient((r) async => http.Response(jsonEncode({'error': 'unknown'}), 500)),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi');
    expect(sender.errors.single, contains('500'));
  });
}

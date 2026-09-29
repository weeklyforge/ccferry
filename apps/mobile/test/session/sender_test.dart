import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/session/sender.dart';

void main() {
  test('send posts text and force=false, collects error events', () async {
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
    await sender.send('hi', confirmForce: () async => false);

    expect(bodies.single, {'text': 'hi', 'force': false});
    expect(sender.errors, ['nope']);
  });

  test('409 session_active asks for confirmation then resends with force', () async {
    final bodies = <Map<String, dynamic>>[];
    var asked = 0;
    final client = ApiClient(
      client: MockClient((r) async {
        final body = jsonDecode((r).body) as Map<String, dynamic>;
        bodies.add(body);
        if (body['force'] == false) {
          return http.Response(jsonEncode({'error': 'session_active'}), 409);
        }
        return http.Response('data: {"type":"done"}\n\n', 200);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi', confirmForce: () async => ++asked > 0);

    expect(asked, 1);
    expect(bodies, [
      {'text': 'hi', 'force': false},
      {'text': 'hi', 'force': true},
    ]);
    expect(sender.errors, isEmpty);
  });

  test('declined force confirmation sends nothing else', () async {
    final bodies = <Map<String, dynamic>>[];
    final client = ApiClient(
      client: MockClient((r) async {
        bodies.add(jsonDecode((r).body) as Map<String, dynamic>);
        return http.Response(jsonEncode({'error': 'session_active'}), 409);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi', confirmForce: () async => false);

    expect(bodies.length, 1); // only the original attempt
  });

  test('other errors surface as messages', () async {
    final client = ApiClient(
      client: MockClient((r) async => http.Response(jsonEncode({'error': 'unknown'}), 500)),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );
    final sender = SessionSender(client: client, sessionId: 's1');
    await sender.send('hi', confirmForce: () async => false);
    expect(sender.errors.single, contains('500'));
  });
}

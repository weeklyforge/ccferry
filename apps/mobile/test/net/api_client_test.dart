import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';

void main() {
  test('getJson sends bearer and parses body', () async {
    http.BaseRequest? seen;
    final client = ApiClient(
      client: MockClient((req) async {
        seen = req;
        return http.Response(jsonEncode({'approvals': []}), 200);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    final body = await client.getJson('/api/approvals');
    expect(seen!.headers['Authorization'], 'Bearer tok');
    expect((body as Map)['approvals'], isEmpty);
  });

  test('getJson throws ApiError with parsed body on non-200', () async {
    final client = ApiClient(
      client: MockClient((req) async => http.Response(jsonEncode({'error': 'no'}), 403)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await expectLater(
      client.getJson('/api/x'),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 403)),
    );
  });

  test('ssePost throws ApiError with parsed body on non-200', () async {
    final client = ApiClient(
      client: MockClient(
        (req) async => http.Response(jsonEncode({'error': 'session_active'}), 409),
      ),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await expectLater(
      client.ssePost('/api/sessions/s/messages', {'text': 'x'}, (_) {}),
      throwsA(isA<ApiError>()
          .having((e) => e.status, 'status', 409)
          .having((e) => e.body['error'], 'error', 'session_active')),
    );
  });

  test('ssePost sets bearer + json content type and feeds payloads', () async {
    final events = <String>[];
    http.BaseRequest? seen;
    final client = ApiClient(
      client: MockClient.streaming((req, bodyStream) async {
        seen = req;
        return http.StreamedResponse(
          Stream.value(utf8.encode('data: one\n\ndata: two\n\n')),
          200,
        );
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await client.ssePost('/api/x', {'a': 1}, events.add);
    expect(seen!.headers['Authorization'], 'Bearer tok');
    expect(seen!.headers['Content-Type'], contains('application/json'));
    expect(events, ['one', 'two']);
  });

  test('sseGetUrl appends token as query param', () {
    final client = ApiClient(
      client: MockClient((req) async => http.Response('', 200)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    expect(
      client.sseGetUrl('/api/sessions/s/stream?fromStart=true').toString(),
      contains('token=tok'),
    );
  });

  test('sseGetUrl omits token when unauthenticated', () {
    final client = ApiClient(
      client: MockClient((req) async => http.Response('', 200)),
      base: () => Uri.parse('https://x.example'),
      token: () => null,
    );
    expect(client.sseGetUrl('/api/x').queryParameters.containsKey('token'), isFalse);
  });
}

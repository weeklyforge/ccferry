import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/push/push_service.dart';

void main() {
  ApiClient clientRecording(List<Map<String, dynamic>> bodies,
          {Future<String?> Function()? token}) =>
      ApiClient(
        client: MockClient((r) async {
          bodies.add(jsonDecode((r).body) as Map<String, dynamic>);
          return http.Response('', 204);
        }),
        base: () => Uri.parse('https://x'),
        token: () => 't',
      );

  test('bootstrap posts clientId platform and fcm token', () async {
    final bodies = <Map<String, dynamic>>[];
    final service = PushService(
      client: clientRecording(bodies),
      clientId: 'c1',
      platform: 'ios',
      getToken: () async => 'fcm-token-1',
    );
    await service.bootstrap();
    expect(bodies, [
      {'clientId': 'c1', 'platform': 'ios', 'fcmToken': 'fcm-token-1'},
    ]);
    expect(service.subscribed, isTrue);
  });

  test('same token is not re-posted; rotated token re-upserts', () async {
    final bodies = <Map<String, dynamic>>[];
    var token = 'fcm-token-1';
    final service = PushService(
      client: clientRecording(bodies),
      clientId: 'c1',
      platform: 'android',
      getToken: () async => token,
    );
    await service.bootstrap();
    await service.bootstrap(); // unchanged — suppressed
    expect(bodies.length, 1);
    token = 'fcm-token-2'; // app update rotated the token
    await service.bootstrap();
    expect(bodies.length, 2);
    expect(bodies[1]['fcmToken'], 'fcm-token-2');
  });

  test('null token posts nothing', () async {
    final bodies = <Map<String, dynamic>>[];
    final service = PushService(
      client: clientRecording(bodies),
      clientId: 'c1',
      platform: 'ios',
      getToken: () async => null,
    );
    await service.bootstrap();
    expect(bodies, isEmpty);
    expect(service.subscribed, isFalse);
  });

  test('tap routing maps the sessionId payload to the callback', () {
    final seen = <String>[];
    final service = PushService(
      client: clientRecording([]),
      clientId: 'c1',
      platform: 'ios',
      getToken: () async => null,
    );
    service.onTap(seen.add);
    service.handleTap({'sessionId': 's42', 'kind': 'result'});
    service.handleTap({'kind': 'approval'}); // no session — ignored
    expect(seen, ['s42']);
  });

  test('bootstrap wires listeners exactly once regardless of onTap order', () async {
    final seen = <String>[];
    final service = PushService(
      client: clientRecording([]),
      clientId: 'c1',
      platform: 'ios',
      getToken: () async => 'fcm-token-1',
    );
    // The app calls onTap before bootstrap (main.dart wiring order).
    service.onTap(seen.add);
    expect(service.listenersWired, isFalse);
    await service.bootstrap();
    expect(service.listenersWired, isTrue);
    // A retry path calling onTap again must not stack handlers.
    service.onTap(seen.add);
    service.handleTap({'sessionId': 's1'});
    expect(seen, ['s1']);
  });
}

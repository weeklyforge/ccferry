import 'dart:convert';

import 'package:ccferry_mobile/lib/post_events.dart';
import 'package:ccferry_mobile/net/api_client.dart';

// Sends 续聊 messages (port of the pwa SessionView.send flow). A 409
// session_active — the daemon's red line for a session the local TUI may be
// writing — asks the user through confirmForce and only resends with
// force=true on explicit consent.
class SessionSender {
  SessionSender({required this.client, required this.sessionId});

  final ApiClient client;
  final String sessionId;
  bool sending = false;

  final errors = <String>[];

  Future<void> send(String text, {required Future<bool> Function() confirmForce}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || sending) return;
    sending = true;
    var force = false;
    try {
      for (;;) {
        try {
          await client.ssePost('/api/sessions/$sessionId/messages', {
            'text': trimmed,
            'force': force,
          }, _onEvent);
          return;
        } on ApiError catch (e) {
          if (e.status == 409 && e.body['error'] == 'session_active' && !force) {
            if (await confirmForce()) {
              force = true;
              continue; // explicit user consent — one retry with force
            }
            return; // declined
          }
          errors.add('${e.status} ${e.body['error'] ?? ''}'.trim());
          return;
        }
      }
    } catch (e) {
      errors.add(e.toString());
    } finally {
      sending = false;
    }
  }

  void _onEvent(String data) {
    try {
      final message = postEventError(jsonDecode(data) as Map<String, dynamic>);
      if (message != null) errors.add(message);
    } catch (_) {
      // malformed frame — ignore
    }
  }
}

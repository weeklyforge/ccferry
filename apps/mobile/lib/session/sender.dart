import 'dart:convert';

import 'package:ccferry_mobile/lib/post_events.dart';
import 'package:ccferry_mobile/net/api_client.dart';

// Sends 续聊 messages (port of the pwa SessionView.send flow). The daemon's
// active-session guard is absolute — a 409 session_active means the session
// is being written on the PC, so the error is surfaced and there is no
// force retry. autoMode asks the daemon to run the turn in the session's
// auto permission mode (tool calls run without per-tool approval cards).
class SessionSender {
  SessionSender({required this.client, required this.sessionId});

  final ApiClient client;
  final String sessionId;
  bool sending = false;

  final errors = <String>[];

  Future<void> send(String text, {bool autoMode = false}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || sending) return;
    sending = true;
    try {
      await client.ssePost('/api/sessions/$sessionId/messages', {
        'text': trimmed,
        if (autoMode) 'mode': 'auto',
      }, _onEvent);
    } on ApiError catch (e) {
      if (e.status == 409 && e.body['error'] == 'session_active') {
        errors.add('会话正在 PC 端使用，请稍后再试');
      } else {
        errors.add('${e.status} ${e.body['error'] ?? ''}'.trim());
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

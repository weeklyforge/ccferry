import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/net/follow.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/bubbles.dart';
import 'package:ccferry_mobile/session/line_dedupe.dart';

// Owns the live tailed render of one session (port of the pwa SessionView
// stream wiring): dedupe absorbs reconnect replays, tool results pair by
// tool_use_id, and a full-history reload reconnects WITHOUT clearing —
// the view must not flash on reconnects or on 加载全部历史.
class SessionStreamModel extends ChangeNotifier {
  SessionStreamModel({required this.connect, this.tailBytes = 262144});

  final Future<Stream<String>> Function(String path) connect;
  final int tailBytes;

  final List<Bubble> bubbles = [];
  final Map<String, ToolPair> toolResults = {};
  final Set<String> expanded = {};
  bool fullHistory = false;

  final LineDedupe _dedupe = LineDedupe();
  int _lineNo = 0;
  String? _sessionId;
  FollowHandle? _handle;

  void start({required String sessionId, bool fullHistory = false}) {
    _sessionId = sessionId;
    this.fullHistory = fullHistory;
    _open();
    notifyListeners(); // mode flips (e.g. 加载全部历史) render immediately
  }

  void loadFullHistory() => start(sessionId: _sessionId!, fullHistory: true);

  void _open() {
    _handle?.close();
    final tail = fullHistory ? '' : '&tailBytes=$tailBytes';
    _handle = followSse(
      connect: () => connect('/api/sessions/$_sessionId/stream?fromStart=true$tail'),
      onLine: _onLine,
      onReset: () {},
      delay: (d) => Future<void>.delayed(d),
    );
  }

  void _onLine(String data) {
    final parsed = parseSessionLine(data, ++_lineNo);
    if (!_dedupe.firstOf(parsed)) return;
    final result = extractToolResult(parsed);
    if (result != null) toolResults[result.id] = result;
    bubbles.addAll(parsedLineToBubbles(parsed));
    notifyListeners();
  }

  void toggle(String toolUseId) {
    if (!expanded.add(toolUseId)) {
      expanded.remove(toolUseId);
    }
    notifyListeners();
  }

  void close() {
    _handle?.close();
    _handle = null;
  }

  @override
  void dispose() {
    close();
    super.dispose();
  }
}

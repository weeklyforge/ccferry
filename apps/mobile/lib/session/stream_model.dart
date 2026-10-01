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

  // Optimistic echo: the text shown at the end of the list from the moment
  // the user hits send, until the session file's own user line streams back
  // (the daemon's echo can lag several seconds). A send that errors out
  // cancels it instead of waiting forever.
  String? pendingSend;

  final LineDedupe _dedupe = LineDedupe();
  int _lineNo = 0;
  String? _sessionId;
  FollowHandle? _handle;

  void beginSend(String text) {
    pendingSend = text;
    notifyListeners();
  }

  void cancelPendingSend() {
    if (pendingSend == null) return;
    pendingSend = null;
    notifyListeners();
  }

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
    final absorbed = _absorbPending(parsed);
    if (!_dedupe.firstOf(parsed)) {
      // A replayed echo (post-reconnect) skips the bubble path — the pending
      // pill must still clear or it would hang forever.
      if (absorbed) notifyListeners();
      return;
    }
    final result = extractToolResult(parsed);
    if (result != null) toolResults[result.id] = result;
    bubbles.addAll(parsedLineToBubbles(parsed));
    notifyListeners();
  }

  // Clears pendingSend when a line carries the matching user text. Runs
  // before dedupe so a replayed line counts too.
  bool _absorbPending(ParsedLine p) {
    final pending = pendingSend;
    if (pending == null || !p.ok) return false;
    if (p.json!['type'] != 'user') return false;
    final cap = pending.length > bubbleTextCap ? pending.substring(0, bubbleTextCap) : pending;
    for (final block in contentBlocks(p.json!)) {
      if (block is TextBlock && block.text == cap) {
        pendingSend = null;
        return true;
      }
    }
    return false;
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

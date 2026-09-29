import 'dart:convert';

import 'package:ccferry_mobile/protocol/events.dart';

// Remembers which session lines are already on screen so a tailed replay
// after an SSE reconnect is skipped instead of clearing and redrawing the
// view (the visible "content flashes every few seconds" symptom).
class LineDedupe {
  LineDedupe({this.capacity = 600});

  final int capacity;
  final Set<String> _seen = {};
  final List<String> _order = [];

  // True when the line was NOT seen before (caller should render it).
  bool firstOf(ParsedLine line) {
    final key = _keyOf(line);
    if (_seen.contains(key)) return false;
    _seen.add(key);
    _order.add(key);
    if (_order.length > capacity) {
      final drop = _order.sublist(0, capacity ~/ 3);
      _order.removeRange(0, capacity ~/ 3);
      _seen.removeAll(drop);
    }
    return true;
  }

  String _keyOf(ParsedLine line) {
    if (line.ok) {
      final uuid = line.json!['uuid'];
      if (uuid is String) return 'u$uuid';
      return 'j${jsonEncode(line.json).substringSafe(256)}';
    }
    return 'r${(line.raw ?? '').substringSafe(256)}';
  }

  void reset() {
    _seen.clear();
    _order.clear();
  }
}

extension on String {
  String substringSafe(int n) => length <= n ? this : substring(0, n);
}

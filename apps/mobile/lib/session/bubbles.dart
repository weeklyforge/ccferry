import 'dart:convert';

import 'package:ccferry_mobile/protocol/events.dart';

// Local wall-clock label for the bubble: HH:mm today, MM-dd HH:mm otherwise.
String fmtTime(String iso, DateTime now) {
  var d = DateTime.tryParse(iso);
  if (d == null) return '';
  if (d.isUtc) d = d.toLocal(); // session lines are Z-suffixed; label local
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  final sameDay =
      d.year == now.year && d.month == now.month && d.day == now.day;
  if (sameDay) return '$hh:$mm';
  final mo = d.month.toString().padLeft(2, '0');
  final dd = d.day.toString().padLeft(2, '0');
  return '$mo-$dd $hh:$mm';
}

extension _Cap on String {
  String _head(int n) => length <= n ? this : substring(0, n);
}

sealed class Bubble {
  const Bubble({this.ts});
  final String? ts;
}

// Rendered text bubbles never carry more than this many characters; the
// pending-send matcher must compare against the same cap.
const bubbleTextCap = 2000;

class TextBubble extends Bubble {
  const TextBubble({required this.role, required this.text, super.ts});
  final String role; // 'user' | 'assistant'
  final String text;
}

class ToolBubble extends Bubble {
  const ToolBubble(
      {required this.name, required this.summary, this.toolUseId, super.ts});
  final String name, summary;
  final String? toolUseId;
}

class RawBubble extends Bubble {
  const RawBubble(this.text);
  final String text;
}

class ToolPair {
  const ToolPair(this.id, this.text, this.isError);
  final String id, text;
  final bool isError;
}

String _basename(String path) => path.split(RegExp(r'[\\/]')).last;

// One-line gist for the collapsed tool row: the parameter a human scans for.
String toolSummary(String name, Map<String, dynamic> input) {
  final file = input['file_path'] ?? input['notebook_path'];
  if (file is String) return _basename(file);
  final command = input['command'];
  if (command is String) {
    return command.replaceAll(RegExp(r'\s+'), ' ')._head(90);
  }
  final pattern = input['pattern'] ?? input['query'] ?? input['url'] ?? input['description'];
  if (pattern is String) return pattern._head(90);
  final json = jsonEncode(input);
  return json == '{}' ? '' : json._head(90);
}

// Tool results ride the NEXT user line, paired by tool_use_id. Returns null
// when the line carries none.
ToolPair? extractToolResult(ParsedLine p) {
  if (!p.ok) return null;
  for (final block in contentBlocks(p.json!)) {
    if (block is ToolResultBlock) {
      return ToolPair(block.toolUseId, block.text._head(4000), block.isError);
    }
  }
  return null;
}

// One session line may carry several blocks (text + N tool calls), so a
// line maps to MULTIPLE bubbles.
List<Bubble> parsedLineToBubbles(ParsedLine p) {
  if (!p.ok) {
    final raw = (p.raw ?? '').trim();
    return raw.isEmpty ? [] : [RawBubble(raw._head(200))];
  }
  final json = p.json!;
  final type = json['type'];
  if (type != 'user' && type != 'assistant') return [];
  final tsField = json['timestamp'];
  final ts = tsField is String ? fmtTime(tsField, DateTime.now()) : null;
  final out = <Bubble>[];
  for (final block in contentBlocks(json)) {
    if (block is TextBlock && block.text.trim().isNotEmpty) {
      out.add(TextBubble(role: type as String, text: block.text._head(bubbleTextCap), ts: ts));
    }
    if (block is ToolUseBlock) {
      out.add(ToolBubble(
        name: block.name,
        summary: toolSummary(block.name, block.input),
        toolUseId: block.id,
        ts: ts,
      ));
    }
  }
  return out;
}

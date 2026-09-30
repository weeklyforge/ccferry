import 'dart:convert';

class ParsedLine {
  const ParsedLine.ok(this.line, this.json)
      : ok = true,
        raw = null;
  const ParsedLine.bad(this.line, this.raw)
      : ok = false,
        json = null;
  final bool ok;
  final int line;
  final Map<String, dynamic>? json;
  final String? raw;
}

// Mirrors packages/protocol ParsedLine semantics: the wire payload is the
// daemon's ParsedLine envelope — {"ok":true,"line":N,"json":{...}} or
// {"ok":false,"line":N,"raw":"..."} — and this unwraps it to the local
// ParsedLine. A malformed payload must never throw (spec R4); a bare JSON
// object without the envelope marker falls back to a bare session line.
ParsedLine parseSessionLine(String raw, int line) {
  try {
    final value = jsonDecode(raw);
    if (value is Map<String, dynamic>) {
      final ok = value['ok'];
      if (ok is bool) {
        final n = (value['line'] as num?)?.toInt() ?? line;
        if (ok) {
          final inner = value['json'];
          if (inner is Map<String, dynamic>) return ParsedLine.ok(n, inner);
          return ParsedLine.bad(n, raw); // envelope without a json object
        }
        return ParsedLine.bad(n, (value['raw'] as String?) ?? raw);
      }
      return ParsedLine.ok(line, value);
    }
  } catch (_) {
    // fall through to raw passthrough (spec R4)
  }
  return ParsedLine.bad(line, raw);
}

sealed class ContentBlock {
  const ContentBlock();
}

class TextBlock extends ContentBlock {
  const TextBlock(this.text);
  final String text;
}

class ToolUseBlock extends ContentBlock {
  const ToolUseBlock(this.id, this.name, this.input);
  final String? id; // optional — matches the pwa renderer (name is required)
  final String name;
  final Map<String, dynamic> input;
}

class ToolResultBlock extends ContentBlock {
  const ToolResultBlock(this.toolUseId, this.text, this.isError);
  final String toolUseId;
  final String text;
  final bool isError;
}

// Extracts the message content blocks the PWA renderer consumes: plain text
// content becomes a single TextBlock; block arrays are filtered by type.
List<ContentBlock> contentBlocks(Map<String, dynamic> json) {
  final message = json['message'];
  if (message is! Map<String, dynamic>) return const [];
  final content = message['content'];
  if (content is String) return [TextBlock(content)];
  if (content is! List) return const [];
  final out = <ContentBlock>[];
  for (final block in content) {
    if (block is! Map<String, dynamic>) continue;
    switch (block['type']) {
      case 'text':
        final text = block['text'];
        if (text is String) out.add(TextBlock(text));
      case 'tool_use':
        final name = block['name'];
        if (name is String) {
          out.add(ToolUseBlock(
              block['id'] as String?,
              name,
              (block['input'] as Map?)?.cast<String, dynamic>() ?? {}));
        }
      case 'tool_result':
        final id = block['tool_use_id'];
        if (id is String) {
          final inner = block['content'];
          var text = '';
          if (inner is String) text = inner;
          if (inner is List) {
            text = inner
                .whereType<Map>()
                .where((b) => b['type'] == 'text')
                .map((b) => (b['text'] as String?) ?? '')
                .join('\n');
          }
          out.add(ToolResultBlock(id, text, block['is_error'] == true));
        }
    }
  }
  return out;
}

class SessionSummary {
  const SessionSummary({
    required this.sessionId,
    required this.projectPath,
    required this.file,
    required this.sizeBytes,
    required this.lastModifiedMs,
    required this.firstUserText,
  });

  factory SessionSummary.fromJson(Map<String, dynamic> j) => SessionSummary(
        sessionId: j['sessionId'] as String,
        projectPath: j['projectPath'] as String,
        file: j['file'] as String,
        sizeBytes: (j['sizeBytes'] as num).toInt(),
        lastModifiedMs: (j['lastModifiedMs'] as num).toInt(),
        firstUserText: j['firstUserText'] as String? ?? '',
      );

  final String sessionId, projectPath, file, firstUserText;
  final int sizeBytes, lastModifiedMs;
}

class ToolApprovalRequest {
  const ToolApprovalRequest({
    required this.approvalId,
    required this.sessionId,
    required this.toolName,
    required this.input,
    required this.createdAtMs,
    required this.timeoutMs,
  });

  factory ToolApprovalRequest.fromJson(Map<String, dynamic> j) =>
      ToolApprovalRequest(
        approvalId: j['approvalId'] as String,
        sessionId: j['sessionId'] as String?,
        toolName: j['toolName'] as String,
        input: (j['input'] as Map?)?.cast<String, dynamic>() ?? {},
        createdAtMs: (j['createdAtMs'] as num).toInt(),
        timeoutMs: (j['timeoutMs'] as num).toInt(),
      );

  final String approvalId, toolName;
  final String? sessionId;
  final Map<String, dynamic> input;
  final int createdAtMs, timeoutMs;
}

class ApprovalSettledFrame {
  const ApprovalSettledFrame({required this.approvalId, required this.decision});

  factory ApprovalSettledFrame.fromJson(Map<String, dynamic> j) =>
      ApprovalSettledFrame(
          approvalId: j['approvalId'] as String, decision: j['decision'] as String);

  final String approvalId, decision;
}

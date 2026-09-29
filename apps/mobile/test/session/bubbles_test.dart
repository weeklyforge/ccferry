import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/bubbles.dart';

ParsedLine okLine(int n, Map<String, dynamic> json) => ParsedLine.ok(n, json);

void main() {
  test('maps user/assistant text lines to text bubbles', () {
    final user =
        parsedLineToBubbles(okLine(1, {'type': 'user', 'message': {'content': 'hi'}}));
    expect((user.single as TextBubble).role, 'user');
    expect((user.single as TextBubble).text, 'hi');
    final assistant =
        parsedLineToBubbles(okLine(2, {'type': 'assistant', 'message': {'content': 'bo'}}));
    expect((assistant.single as TextBubble).text, 'bo');
  });

  test('maps every block: text plus ALL tool calls of one line', () {
    final bubbles = parsedLineToBubbles(okLine(3, {
      'type': 'assistant',
      'timestamp': '2026-09-27T14:05:00.000Z',
      'message': {
        'content': [
          {'type': 'text', 'text': 'let me fix that'},
          {
            'type': 'tool_use',
            'id': 't1',
            'name': 'Edit',
            'input': {'file_path': r'D:\work\pkg\src\a.md'},
          },
          {
            'type': 'tool_use',
            'id': 't2',
            'name': 'Bash',
            'input': {'command': 'systemctl restart taos\nls -la'},
          },
        ],
      },
    }));
    expect(bubbles.length, 3);
    expect((bubbles[0] as TextBubble).text, 'let me fix that');
    final t1 = bubbles[1] as ToolBubble;
    expect(t1.summary, 'a.md');
    expect(t1.toolUseId, 't1');
    expect((bubbles[2] as ToolBubble).summary, 'systemctl restart taos ls -la');
    expect(t1.ts, matches(RegExp(r'^(?:\d{2}-\d{2} )?\d{2}:\d{2}$')));
  });

  test('summarizes grep by pattern and unknown tools by json', () {
    final grep = parsedLineToBubbles(okLine(4, {
      'type': 'assistant',
      'message': {
        'content': [
          {'type': 'tool_use', 'name': 'Grep', 'input': {'pattern': 'sn_prod', 'path': 'x'}},
        ],
      },
    })).single as ToolBubble;
    expect(grep.summary, 'sn_prod');
    final weird = parsedLineToBubbles(okLine(5, {
      'type': 'assistant',
      'message': {
        'content': [
          {'type': 'tool_use', 'name': 'Foo', 'input': {'a': 1}},
        ],
      },
    })).single as ToolBubble;
    expect(weird.summary, '{"a":1}');
  });

  test('maps failed lines to raw bubbles and skips noise', () {
    expect(
        (parsedLineToBubbles(const ParsedLine.bad(4, 'garbage{')).single as RawBubble).text,
        'garbage{');
    expect(parsedLineToBubbles(const ParsedLine.bad(5, '   ')), isEmpty);
    expect(parsedLineToBubbles(okLine(6, {'type': 'system', 'subtype': 'init'})), isEmpty);
  });

  test('extractToolResult pairs by tool_use_id', () {
    final p = okLine(7, {
      'type': 'user',
      'message': {
        'content': [
          {
            'type': 'tool_result',
            'tool_use_id': 't1',
            'content': [
              {'type': 'text', 'text': 'The file has been updated.'},
            ],
          },
        ],
      },
    });
    expect(extractToolResult(p)!.id, 't1');
    expect(extractToolResult(p)!.text, 'The file has been updated.');
    expect(extractToolResult(p)!.isError, isFalse);
  });

  test('extractToolResult handles string content, errors, and absence', () {
    final err = extractToolResult(okLine(8, {
      'type': 'user',
      'message': {
        'content': [
          {'type': 'tool_result', 'tool_use_id': 't2', 'content': 'boom', 'is_error': true},
        ],
      },
    }));
    expect(err!.text, 'boom');
    expect(err.isError, isTrue);
    expect(
        extractToolResult(okLine(9, {'type': 'user', 'message': {'content': 'plain'}})), isNull);
    expect(extractToolResult(const ParsedLine.bad(10, 'x')), isNull);
  });

  test('fmtTime: HH:mm today, MM-dd HH:mm otherwise', () {
    final now = DateTime(2026, 9, 29, 10, 0);
    expect(fmtTime(DateTime(2026, 9, 29, 8, 5).toIso8601String(), now), '08:05');
    expect(fmtTime(DateTime(2026, 9, 1, 8, 5).toIso8601String(), now), '09-01 08:05');
    expect(fmtTime('not-a-date', now), '');
  });
}

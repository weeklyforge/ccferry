import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';

void main() {
  test('parses a valid session line', () {
    final p = parseSessionLine(jsonEncode({'type': 'assistant'}), 1);
    expect(p.ok, isTrue);
    expect(p.json!['type'], 'assistant');
  });

  test('malformed line degrades to raw, no exception', () {
    final p = parseSessionLine('garbage{', 2);
    expect(p.ok, isFalse);
    expect(p.raw, 'garbage{');
    expect(p.json, isNull);
  });

  test('non-map json degrades to raw', () {
    final p = parseSessionLine('[1,2]', 3);
    expect(p.ok, isFalse);
  });

  test('daemon ParsedLine envelope unwraps to the session line', () {
    // The wire payload is the packages/protocol ParsedLine envelope, not a
    // bare session line: {"ok":true,"line":N,"json":{...}}.
    final p = parseSessionLine(
        '{"ok":true,"line":7,"json":{"type":"assistant","message":{"content":"hi"}}}', 1);
    expect(p.ok, isTrue);
    expect(p.line, 7);
    expect(p.json!['type'], 'assistant');
  });

  test('bad envelope exposes the original raw text', () {
    final p = parseSessionLine('{"ok":false,"line":3,"raw":"broken{"}', 1);
    expect(p.ok, isFalse);
    expect(p.raw, 'broken{');
  });

  test('envelope with non-map json degrades to raw', () {
    final p = parseSessionLine('{"ok":true,"line":4,"json":[1,2]}', 1);
    expect(p.ok, isFalse);
  });

  test('contentBlocks maps text and all tool_use blocks', () {
    final blocks = contentBlocks({
      'message': {
        'content': [
          {'type': 'text', 'text': 'let me fix that'},
          {'type': 'tool_use', 'id': 't1', 'name': 'Edit', 'input': {'file_path': 'a.md'}},
          {'type': 'tool_use', 'id': 't2', 'name': 'Bash', 'input': {'command': 'ls'}},
        ],
      },
    });
    expect(blocks.length, 3);
    expect((blocks[0] as TextBlock).text, 'let me fix that');
    expect((blocks[1] as ToolUseBlock).id, 't1');
    expect((blocks[2] as ToolUseBlock).name, 'Bash');
  });

  test('contentBlocks maps string content and tool_result blocks', () {
    expect(
        (contentBlocks({'message': {'content': 'hi'}}).single as TextBlock).text, 'hi');
    final tr = contentBlocks({
      'message': {
        'content': [
          {'type': 'tool_result', 'tool_use_id': 't1', 'content': 'boom', 'is_error': true},
        ],
      },
    }).single as ToolResultBlock;
    expect(tr.toolUseId, 't1');
    expect(tr.isError, isTrue);
  });

  test('contentBlocks returns empty for missing/odd content', () {
    expect(contentBlocks({}), isEmpty);
    expect(contentBlocks({'message': {'content': 42}}), isEmpty);
  });
}

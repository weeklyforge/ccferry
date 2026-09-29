# M5 Flutter Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thin-v1 Flutter native client (sessions, live stream, continue chat, approvals, FCM push) against the untouched M1–M4 backend, plus the cloud-side FCM push channel and the iOS CI pipeline.

**Architecture:** Flutter app in `apps/mobile` (outside the pnpm workspace) consumes the existing daemon API through the Caddy tunnel exactly like the PWA. The cloud server gains an additive FCM subscription store + sender path; the web-push path stays byte-identical. Pure session logic (bubbles, dedupe, status, SSE framing, backoff) is ported from the PWA sources and pinned by mirrored unit tests before any UI exists.

**Tech Stack:** Flutter/Dart (`http`, `provider`, `flutter_secure_storage`, `flutter_markdown` fork per Task 10 spike, `firebase_core`/`firebase_messaging` in Task 14), TypeScript cloud (fastify + vitest, `firebase-admin` behind a dynamic import).

**Spec:** `docs/superpowers/specs/2026-09-29-m5-flutter-app-design.md`

## Global Constraints

- Code and code comments in English only; UI copy may be Chinese (copy mirrors the PWA strings verbatim where given).
- Commits: conventional subject + markdown bullet body, no `Co-Authored-By`, never push without an explicit owner request.
- Never commit tokens, the Firebase service-account JSON, `GoogleService-Info.plist`, or `google-services.json` — local placement + CI secrets only.
- Web-push store/routes/sender (`packages/cloud/src/push/store.ts`, `sender.ts`, `api/push-routes.ts` web paths) must remain byte-identical; all FCM code is additive in new files.
- Constants ported verbatim from PWA sources: `TAIL_BYTES = 262_144`; retry `2000 ms` doubling, cap `30_000 ms`; `LineDedupe` capacity `600`, evict `1/3`; tool-result text cap `4000`; bubble text cap `2000`; tool summary cap `90`; `ACTIVITY_WINDOW_MS = 120_000`.
- Auth mirrors the PWA byte-for-byte: REST `Authorization: Bearer <token>`; SSE GET `?token=` query param; SSE-over-POST Bearer + JSON, frames split on `\n\n`, payload after `data: `.
- The 409 `session_active` red line is daemon-side; the app only shows a confirm dialog and resends with `force: true`. No bypass path exists client-side.
- `apps/mobile` is not a pnpm package: `pnpm -r test` / `pnpm -r typecheck` must not reach it. Flutter gates: `flutter test` and `flutter analyze` clean.
- Platform build order (spec R2): the CI signing spike (Task 15) runs against the scaffold app before any refinement — do not "improve" it into a full pipeline first.

## Review Focus

Input classes the spec implies but the happy-path tests may not exercise; each is pinned by the named task's tests:

1. A JSONL line that is truncated or non-JSON mid-stream must become a raw bubble, never an exception (Task 2).
2. An SSE chunk boundary landing inside a frame (no `\n\n` yet) must buffer, not emit a partial event (Task 5).
3. An unknown `tool_use` input shape (no file_path/command/pattern) must fall back to the JSON summary, never throw (Task 3).
4. A 409 `session_active` must surface a confirm dialog and only resend on explicit user consent (Task 10).
5. An FCM send to an uninstalled/expired token must prune exactly that subscription and leave others untouched (Task 13).

---

### Task 1: Flutter scaffold

**Files:**
- Create: `apps/mobile/**` (via `flutter create`), reduced to `lib/main.dart`, `test/smoke_test.dart`

**Interfaces:**
- Produces: the `apps/mobile` Flutter project, appId `com.fetaoily.ccferry`, with deps `http`, `provider`, `flutter_secure_storage`; `cd apps/mobile && flutter test` as the per-task gate for all later tasks.

- [ ] **Step 1: Scaffold**

```bash
cd apps 2>/dev/null || mkdir apps && cd apps
flutter create --org com.fetaoily --project-name ccferry_mobile mobile
cd mobile
flutter pub add http provider flutter_secure_storage
```

Delete the counter demo: replace `lib/main.dart` body with a minimal `MaterialApp(home: Scaffold(body: Center(Text('ccferry'))))` shell and delete `lib/counter_*` / widget-test remnants.

Confirm `pnpm-workspace.yaml` only globs `packages/*` so `apps/` stays out of the workspace (read it; if it globs `**`, exclude `apps/**`).

- [ ] **Step 2: Write the smoke test**

```dart
// apps/mobile/test/smoke_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/main.dart' as app;

void main() {
  testWidgets('app shell builds', (tester) async {
    await tester.pumpWidget(const app.CcferryApp());
    expect(find.text('ccferry'), findsOneWidget);
  });
}
```

(`CcferryApp` is the public `MaterialApp` widget `main.dart` exports; later tasks swap its `home`/routes.)

- [ ] **Step 3: Run — expect PASS**, `flutter analyze` clean.
- [ ] **Step 4: Commit** `feat(mobile): scaffold flutter app`.

### Task 2: Protocol mirror + fault-tolerant JSONL parse

**Files:**
- Create: `apps/mobile/lib/protocol/events.dart`
- Test: `apps/mobile/test/protocol/events_test.dart`
- Authority (read, do not modify): `packages/protocol/src/index.ts` (`ParsedLine`, `SessionSummary`, `ToolApprovalRequest`, `ApprovalSettledFrame`), `packages/pwa/src/lib/bubbles.ts:40-92` (content-block extraction shape)

**Interfaces:**
- Produces: `ParsedLine` (`ok/line/json/raw`), `parseSessionLine(String raw, int line) → ParsedLine`, `sealed class ContentBlock` with `TextBlock(text)`, `ToolUseBlock(id, name, input)`, `ToolResultBlock(toolUseId, text, isError)`, `contentBlocks(Map<String, dynamic> json) → List<ContentBlock>`, `SessionSummary`, `ToolApprovalRequest`, `ApprovalSettledFrame` models.

- [ ] **Step 1: Write the failing tests**

```dart
// apps/mobile/test/protocol/events_test.dart
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
    expect((contentBlocks({'message': {'content': 'hi'}}).single as TextBlock).text, 'hi');
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
```

- [ ] **Step 2: Run — expect FAIL** (`events.dart` not found): `cd apps/mobile && flutter test test/protocol/events_test.dart`
- [ ] **Step 3: Implement**

```dart
// apps/mobile/lib/protocol/events.dart
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

ParsedLine parseSessionLine(String raw, int line) {
  try {
    final value = jsonDecode(raw);
    if (value is Map<String, dynamic>) return ParsedLine.ok(line, value);
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
  final String id;
  final String name;
  final Map<String, dynamic> input;
}

class ToolResultBlock extends ContentBlock {
  const ToolResultBlock(this.toolUseId, this.text, this.isError);
  final String toolUseId;
  final String text;
  final bool isError;
}

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
        final id = block['id'];
        final name = block['name'];
        if (id is String && name is String) {
          out.add(ToolUseBlock(id, name, (block['input'] as Map?)?.cast<String, dynamic>() ?? {}));
        }
      case 'tool_result':
        final id = block['tool_use_id'];
        if (id is String) {
          final inner = block['content'];
          String text = '';
          if (inner is String) text = inner;
          if (inner is List) {
            text = inner
                .whereType<Map<String, dynamic>>()
                .where((b) => b['type'] == 'text')
                .map((b) => b['text'] as String? ?? '')
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
  factory ToolApprovalRequest.fromJson(Map<String, dynamic> j) => ToolApprovalRequest(
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
      ApprovalSettledFrame(approvalId: j['approvalId'] as String, decision: j['decision'] as String);
  final String approvalId, decision;
}
```

- [ ] **Step 4: Run — PASS**, full `flutter test` still green.
- [ ] **Step 5: Commit** `feat(mobile): protocol mirror with fault-tolerant jsonl parse`.

### Task 3: Bubbles port

**Files:**
- Create: `apps/mobile/lib/session/bubbles.dart`
- Test: `apps/mobile/test/session/bubbles_test.dart`
- Authority: `packages/pwa/src/lib/bubbles.ts` (port semantics and constants 1:1), `packages/pwa/src/lib/bubbles.test.ts` (mirror every case)

**Interfaces:**
- Consumes: `ParsedLine`, `contentBlocks`, `TextBlock/ToolUseBlock/ToolResultBlock` (Task 2).
- Produces: `sealed class Bubble` with `TextBubble(role, text, ts?)`, `ToolBubble(name, summary, toolUseId?, ts?)`, `RawBubble(text)`; `List<Bubble> parsedLineToBubbles(ParsedLine p)`; `ToolPair? extractToolResult(ParsedLine p)` where `ToolPair { id, text, isError }`; `String fmtTime(String iso, DateTime now)`.

- [ ] **Step 1: Write the failing tests** — mirror every `bubbles.test.ts` case:

```dart
// apps/mobile/test/session/bubbles_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/bubbles.dart';

ParsedLine okLine(int n, Map<String, dynamic> json) => ParsedLine.ok(n, json);

void main() {
  test('maps user/assistant text lines to text bubbles', () {
    final user = parsedLineToBubbles(okLine(1, {'type': 'user', 'message': {'content': 'hi'}}));
    expect(user.single.role, 'user');
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
          {'type': 'tool_use', 'id': 't1', 'name': 'Edit', 'input': {'file_path': r'D:\work\pkg\src\a.md'}},
          {'type': 'tool_use', 'id': 't2', 'name': 'Bash', 'input': {'command': 'systemctl restart taos\nls -la'}},
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
      'message': {'content': [{'type': 'tool_use', 'name': 'Grep', 'input': {'pattern': 'sn_prod', 'path': 'x'}}]},
    })).single as ToolBubble;
    expect(grep.summary, 'sn_prod');
    final weird = parsedLineToBubbles(okLine(5, {
      'type': 'assistant',
      'message': {'content': [{'type': 'tool_use', 'name': 'Foo', 'input': {'a': 1}}]},
    })).single as ToolBubble;
    expect(weird.summary, '{"a":1}');
  });

  test('maps failed lines to raw bubbles and skips noise', () {
    expect(parsedLineToBubbles(const ParsedLine.bad(4, 'garbage{')).single.text, 'garbage{');
    expect(parsedLineToBubbles(const ParsedLine.bad(5, '   ')), isEmpty);
    expect(parsedLineToBubbles(okLine(6, {'type': 'system', 'subtype': 'init'})), isEmpty);
  });

  test('extractToolResult pairs by tool_use_id', () {
    final p = okLine(7, {
      'type': 'user',
      'message': {
        'content': [
          {'type': 'tool_result', 'tool_use_id': 't1', 'content': [{'type': 'text', 'text': 'The file has been updated.'}]},
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
      'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't2', 'content': 'boom', 'is_error': true}]},
    }));
    expect(err!.text, 'boom');
    expect(err.isError, isTrue);
    expect(extractToolResult(okLine(9, {'type': 'user', 'message': {'content': 'plain'}})), isNull);
    expect(extractToolResult(const ParsedLine.bad(10, 'x')), isNull);
  });

  test('fmtTime: HH:mm today, MM-dd HH:mm otherwise', () {
    final now = DateTime(2026, 9, 29, 10, 0);
    expect(fmtTime(DateTime(2026, 9, 29, 8, 5).toIso8601String(), now), '08:05');
    expect(fmtTime(DateTime(2026, 9, 1, 8, 5).toIso8601String(), now), '09-01 08:05');
    expect(fmtTime('not-a-date', now), '');
  });
}
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — port `bubbles.ts` faithfully: `RawBubble` keeps `raw.trim()` non-empty lines only, sliced to 200 chars; text sliced to 2000; `toolSummary` order = `file_path`/`notebook_path` basename → `command` whitespace-squashed 90 → `pattern`/`query`/`url`/`description` 90 → JSON of the whole input 90 (`{}` → `''`); JSON summaries use compact `jsonEncode`; `extractToolResult` slices text to 4000; bubble `ts` only when `json['timestamp']` is a String. `RawBubble` exposes its text as `text` (the test uses `.text` on `.single`).

```dart
// apps/mobile/lib/session/bubbles.dart (core shape; constants per Global Constraints)
import 'package:ccferry_mobile/protocol/events.dart';

sealed class Bubble {
  const Bubble({this.ts});
  final String? ts;
}

class TextBubble extends Bubble {
  const TextBubble({required this.role, required this.text, super.ts});
  final String role; // 'user' | 'assistant'
  final String text;
}

class ToolBubble extends Bubble {
  const ToolBubble({required this.name, required this.summary, this.toolUseId, super.ts});
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

String fmtTime(String iso, DateTime now) {
  final d = DateTime.tryParse(iso);
  if (d == null) return '';
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  final sameDay = d.year == now.year && d.month == now.month && d.day == now.day;
  if (sameDay) return '$hh:$mm';
  final mo = d.month.toString().padLeft(2, '0');
  final dd = d.day.toString().padLeft(2, '0');
  return '$mo-$dd $hh:$mm';
}

String _basename(String path) => path.split(RegExp(r'[\\/]')).last;

String toolSummary(String name, Map<String, dynamic> input) {
  final file = input['file_path'] ?? input['notebook_path'];
  if (file is String) return _basename(file);
  final command = input['command'];
  if (command is String) return command.replaceAll(RegExp(r'\s+'), ' ').substringSafe(90);
  final pattern = input['pattern'] ?? input['query'] ?? input['url'] ?? input['description'];
  if (pattern is String) return pattern.substringSafe(90);
  final json = jsonEncodeCompact(input);
  return json == '{}' ? '' : json.substringSafe(90);
}
```

Add a tiny `extension SubstringSafe on String` (`s.length <= n ? s : s.substring(0, n)`) and `jsonEncodeCompact` (`jsonEncode` with no spaces — Dart's `jsonEncode` is already compact) in the same file. `parsedLineToBubbles` iterates `contentBlocks` for `type == 'user' || 'assistant'`, reading `json['timestamp']` for `ts`; `extractToolResult` returns the first `ToolResultBlock` paired as `ToolPair`.

- [ ] **Step 4: Run — PASS**, suite green.
- [ ] **Step 5: Commit** `feat(mobile): port bubbles model from pwa with mirrored tests`.

### Task 4: LineDedupe + session status

**Files:**
- Create: `apps/mobile/lib/session/line_dedupe.dart`, `apps/mobile/lib/session/session_status.dart`
- Test: `apps/mobile/test/session/line_dedupe_test.dart`, `apps/mobile/test/session/session_status_test.dart`
- Authority: `packages/pwa/src/lib/line-dedupe.ts` + its test (port 1:1: capacity 600, uuid key with hash fallback, evict oldest third, `reset()`), `packages/pwa/src/lib/session-status.ts` (verbatim port below)

**Interfaces:**
- Produces: `class LineDedupe { bool firstOf(ParsedLine line); void reset(); }`, `String sessionStatus(SessionSummary s, DateTime now, List<ToolApprovalRequest> approvals)` returning `'awaiting'|'running'|'idle'`.

- [ ] **Step 1: Write the failing tests** — `line_dedupe_test.dart` mirrors the TS cases (first sight → true, replay → false, capacity eviction keeps the newest 2/3, reset re-admits); `session_status_test.dart`:

```dart
// apps/mobile/test/session/session_status_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/session_status.dart';

void main() {
  test('awaiting when an approval targets the session', () {
    final s = session(lastModifiedMs: 0);
    final a = approval(sessionId: 's1');
    expect(sessionStatus(s, DateTime.fromMillisecondsSinceEpoch(500_000), [a]), 'awaiting');
  });

  test('running inside the activity window, idle outside', () {
    final now = DateTime.fromMillisecondsSinceEpoch(200_000);
    expect(sessionStatus(session(lastModifiedMs: 150_000), now, const []), 'running');
    expect(sessionStatus(session(lastModifiedMs: 50_000), now, const []), 'idle');
  });
}
```

(with local `session()`/`approval()` helpers building the Task 2 models; ACTIVITY window is `120000` ms.)

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `session_status.dart`:

```dart
// apps/mobile/lib/session/session_status.dart
import 'package:ccferry_mobile/protocol/events.dart';

const activityWindowMs = 120000;

String sessionStatus(SessionSummary s, DateTime now, List<ToolApprovalRequest> approvals) {
  if (approvals.any((a) => a.sessionId == s.sessionId)) return 'awaiting';
  if (now.millisecondsSinceEpoch - s.lastModifiedMs < activityWindowMs) return 'running';
  return 'idle';
}
```

`line_dedupe.dart`: port from the authority file — a `Map<String, int>`-backed FIFO ring, `firstOf` returns false for a seen key, evicts the oldest `capacity ~/ 3` entries when size reaches capacity (600), uuid from `json['uuid']` else `_hash(raw)` (FNV-1a over the raw line).

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): port line dedupe and session status`.

### Task 5: SSE framing + reconnect follower

**Files:**
- Create: `apps/mobile/lib/net/sse.dart` (frame splitter + stream parser), `apps/mobile/lib/net/follow.dart` (reconnect loop)
- Test: `apps/mobile/test/net/sse_test.dart`, `apps/mobile/test/net/follow_test.dart`
- Authority: `packages/pwa/src/lib/api.ts:29-65` (`readSsePost` framing), `packages/pwa/src/lib/sse-follow.ts` (backoff semantics, port exactly)

**Interfaces:**
- Produces: `class SseFrameSplitter { List<String> add(String chunk); }` (returns complete `data:` payloads, buffers partials); `Stream<String> parseSse(Stream<String> chunks)`; `FollowHandle followSse({required Future<Stream<String>> Function() connect, required void Function(String) onLine, required void Function() onReset, required Future<void> Function(Duration) delay, Duration retryMs = const Duration(seconds: 2), Duration maxRetryMs = const Duration(seconds: 30)})` with `handle.close()`.

- [ ] **Step 1: Write the failing tests**

```dart
// apps/mobile/test/net/sse_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/net/sse.dart';

void main() {
  test('splits complete frames and buffers partials', () {
    final s = SseFrameSplitter();
    expect(s.add('data: a\n\nda'), isEmpty);
    expect(s.add('ta: b\n\ndata: c\n\n'), ['a', 'b', 'c']);
  });

  test('parses a chunked stream in order', () async {
    final out = await parseSse(Stream.fromIterable(['data: 1\n\ndata:', ' 2\n\n'])).toList();
    expect(out, ['1', ' 2']);
  });
}
```

```dart
// apps/mobile/test/net/follow_test.dart
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/net/follow.dart';

void main() {
  test('reconnects with doubling backoff, capped, and resets on success', () async {
    final delays = <Duration>[];
    var attempts = 0;
    final lines = <String>[];
    late FollowHandle handle;
    handle = followSse(
      connect: () async {
        if (attempts < 5) {
          attempts++;
          throw StateError('down');
        }
        return Stream.fromIterable(['data: hello\n\n']);
      },
      onLine: lines.add,
      onReset: () {},
      delay: (d) async => delays.add(d),
      retryMs: const Duration(seconds: 2),
      maxRetryMs: const Duration(seconds: 30),
    );
    await Future<void>.delayed(const Duration(milliseconds: 50));
    handle.close();
    // 5 failures → 2s, 4s, 8s, 16s, 30s (cap), then success resets attempt to 0
    expect(delays.map((d) => d.inSeconds), [2, 4, 8, 16, 30]);
    expect(lines, ['hello']);
  });

  test('close cancels pending reconnects', () async {
    var connects = 0;
    final handle = followSse(
      connect: () async {
        connects++;
        throw StateError('down');
      },
      onLine: (_) {},
      onReset: () {},
      delay: (_) async {},
    );
    handle.close();
    await Future<void>.delayed(Duration.zero);
    final after = connects;
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(connects, after);
  });
}
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `sse.dart`: the splitter keeps a `StringBuffer`, scans for `\n\n` boundaries, strips the `data: ` prefix per line inside a frame (multi-`data:` frames join payloads with `\n`, mirroring the TS `line.startsWith('data: ')` behavior for single-line frames; our server only sends single-data frames). `parseSse` is `chunks.transform`-style composition over the splitter. `follow.dart`: port `sse-follow.ts` semantics — `connect()` inside a try; success sets a `healthy` flag that resets `attempt = 0` before the first line; stream error/done → `onReset()` then `delay(min(retryMs * 2^attempt, maxRetryMs))`, `attempt += 1`, reconnect; `close()` sets a `closed` flag checked before every reconnect and cancels nothing else (the injected `delay` seam replaces `setTimeout`, so tests run on real microtasks).

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): sse framing and reconnect follower`.

### Task 6: API client

**Files:**
- Create: `apps/mobile/lib/net/api_client.dart`
- Test: `apps/mobile/test/net/api_client_test.dart`
- Authority: `packages/pwa/src/lib/api.ts` (error shape, header rules, SSE-over-POST)

**Interfaces:**
- Consumes: `SseFrameSplitter` (Task 5).
- Produces: `class ApiError implements Exception { final int status; final Map<String, dynamic> body; }`; `class ApiClient { ApiClient({required http.Client client, required Uri Function() base, required String? Function() token}); Future<dynamic> getJson(String path); Future<void> ssePost(String path, Map<String, dynamic> body, void Function(String) onEvent); Uri sseGetUrl(String path); }`

- [ ] **Step 1: Write the failing tests** (uses `package:http/testing.dart` `MockClient`):

```dart
// apps/mobile/test/net/api_client_test.dart (essentials)
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/net/api_client.dart';

void main() {
  test('getJson sends bearer and parses body', () async {
    http.Request? seen;
    final client = ApiClient(
      client: MockClient((req) async {
        seen = req;
        return http.Response(jsonEncode({'approvals': []}), 200);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await client.getJson('/api/approvals');
    expect(seen!.headers['Authorization'], 'Bearer tok');
  });

  test('ssePost throws ApiError with parsed body on non-200', () async {
    final client = ApiClient(
      client: MockClient((req) async => http.Response(jsonEncode({'error': 'session_active'}), 409)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await expectLater(
      client.ssePost('/api/sessions/s/messages', {'text': 'x'}, (_) {}),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 409)
          .having((e) => e.body['error'], 'error', 'session_active')),
    );
  });

  test('ssePost feeds data payloads through the frame splitter', () async {
    final events = <String>[];
    final client = ApiClient(
      client: MockClient.streaming((req, stream) async {
        return http.StreamedResponse(
          Stream.value(utf8.encode('data: one\n\ndata: two\n\n')),
          200,
        );
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => null,
    );
    await client.ssePost('/api/x', {}, events.add);
    expect(events, ['one', 'two']);
  });

  test('sseGetUrl appends token as query param', () {
    final client = ApiClient(
      client: MockClient((req) async => http.Response('', 200)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    expect(client.sseGetUrl('/api/sessions/s/stream?fromStart=true').toString(),
        contains('token=tok'));
  });
}
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `getJson` throws `ApiError` on non-200 (parse JSON body, tolerate non-JSON); `ssePost` uses `client.send(http.Request(...))` with Bearer + `Content-Type: application/json`, on non-200 reads the full body and throws `ApiError`, on 200 decodes UTF-8 chunks through `SseFrameSplitter`; `sseGetUrl` mirrors `sseUrl()` (token as query param).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): api client with bearer auth and sse-over-post`.

### Task 7: State models (auth, approvals, sessions)

**Files:**
- Create: `apps/mobile/lib/state/token_store.dart`, `apps/mobile/lib/state/auth_model.dart`, `apps/mobile/lib/state/approvals_model.dart`, `apps/mobile/lib/state/sessions_model.dart`
- Test: `apps/mobile/test/state/approvals_model_test.dart`, `apps/mobile/test/state/sessions_model_test.dart`
- Authority: `packages/pwa/src/stores/approvals.ts` (port verbatim semantics), `packages/pwa/src/pages/Sessions.vue:23-51,77-93` (groups, refresh, relative time), `packages/pwa/src/lib/project-name.ts` (port `shortProject`)

**Interfaces:**
- Consumes: `ApiClient` (Task 6), `SessionSummary`, `ToolApprovalRequest` (Task 2), `sessionStatus` (Task 4).
- Produces: `abstract class TokenStore { Future<void> save(String base, String token); Future<(String, String)?> load(); }` (+ `SecureTokenStore` impl in Task 8 wiring); `class AuthModel extends ChangeNotifier` (fields `base`, `token`, `clientId`; `bool get ready`; `Future<void> bootstrap()`); `class ApprovalsModel extends ChangeNotifier { List<ToolApprovalRequest> pending; void ingest(...); void removeById(String id); Future<void> decide(String id, String decision); void sweepExpired(DateTime now); }`; `class SessionsModel extends ChangeNotifier { List<SessionSummary> sessions; bool unauthorized; Future<void> refresh(); List<ProjectGroup> get groups; }` where `ProjectGroup { projectPath, shortName, list }`.

- [ ] **Step 1: Write the failing tests** — `approvals_model_test.dart` mirrors the pinia tests: ingest dedupes by `approvalId`; `decide` removes **only after** the POST succeeds (fake `ApiClient` that throws on first decide → list unchanged; succeeding → removed); `sweepExpired` drops `now - createdAtMs >= timeoutMs`. `sessions_model_test.dart`: refresh reads `/api/sessions` (list of `SessionSummary`) and `/api/approvals` (`{"approvals": [...]}` ingested into `ApprovalsModel`); 401 on sessions sets `unauthorized = true` and keeps prior list; `groups` groups by `projectPath` preserving first-seen order, `shortName` mirrors `shortProject` (read the TS and port exactly).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the four files. `decide` posts to `/api/approvals/$id/decision` with `{'decision': decision}` (`'allow' | 'deny'`). `AuthModel.clientId`: a random UUID generated once and persisted through `TokenStore` under key `clientId` (stable across restarts — the cloud foreground map keys on it).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): auth approvals sessions state models`.

### Task 8: Login + session list pages

**Files:**
- Create: `apps/mobile/lib/pages/login_page.dart`, `apps/mobile/lib/pages/sessions_page.dart`, `apps/mobile/lib/main.dart` (modify: provider wiring, routes `/login`, `/sessions`, `/session/:id`)
- Test: `apps/mobile/test/pages/login_page_test.dart`, `apps/mobile/test/pages/sessions_page_test.dart`

**Interfaces:**
- Consumes: `AuthModel`, `ApprovalsModel`, `SessionsModel` (Task 7), `SecureTokenStore` (flutter_secure_storage wrapper: keys `daemonBase`, `token`, `clientId`).

- [ ] **Step 1: Write the failing tests** — login: entering `https://x.example` + `tok`, tapping 保存 (save) calls `TokenStore.save` and lands on sessions. Sessions list: with a stubbed model (fake api returning two sessions in one project), renders the project short name, session first-user text, relative label (`X 分钟前` / `X 小时前`), and the `等你批准` tag when an approval targets the session; pull-to-refresh + 10 s `Timer.periodic` refresh while visible (assert via model call count after `tester.pump(const Duration(seconds: 10))`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — copy structure and Chinese copy from `Sessions.vue`: grouped `ListView` (project header tile = short name + dim path), each row shows first-user text (or `(无摘要)`), status chip `等你批准`/`进行中`/`空闲`, tap → `/session/<id>`; unauthorized → guide card 先到设置页保存访问令牌; loading spinner on first empty load; `RefreshIndicator` + visible-only 10 s poll (start in `initState`, cancel in `dispose`). Login page saves through `AuthModel` and replaces the route stack.
- [ ] **Step 4: Run — PASS**, `flutter analyze` clean.
- [ ] **Step 5: Commit** `feat(mobile): login and session list pages`.

### Task 9: Session stream page (render)

**Files:**
- Create: `apps/mobile/lib/session/stream_model.dart`, `apps/mobile/lib/widgets/bubble_view.dart`, `apps/mobile/lib/pages/session_page.dart`
- Test: `apps/mobile/test/session/stream_model_test.dart`, `apps/mobile/test/pages/session_page_test.dart`
- Authority: `packages/pwa/src/pages/SessionView.vue:43-60,104-137` (pushBubble/dedupe/toolResults/tail/loadFullHistory)

**Interfaces:**
- Consumes: `ApiClient.ssePost/sseGetUrl` + `followSse` (Tasks 5–6), `LineDedupe`, `parsedLineToBubbles`, `extractToolResult` (Tasks 3–4).
- Produces: `class SessionStreamModel extends ChangeNotifier { List<Bubble> bubbles; Map<String, ToolPair> toolResults; Set<String> expanded; void start({required String sessionId, bool fullHistory = false}); void loadFullHistory(); void toggle(String toolUseId); void dispose(); }`

- [ ] **Step 1: Write the failing tests** (model level, fake `connect`): replayed lines (same uuid twice) append once; a `tool_result` line fills `toolResults[toolUseId]`; `loadFullHistory` reconnects without `tailBytes` **without clearing** bubbles (dedupe absorbs the replay); `expanded` toggles by id. Widget test: bubbles render in order — user bubble styled distinctly, assistant bubble shows text, tool bubble shows `⏳` before its result arrives and `✔` after the model's `toolResults` is filled; tapping a tool row toggles the detail pane showing the paired result text.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `start()` builds `sseGetUrl('/api/sessions/$id/stream?fromStart=true' + (fullHistory ? '' : '&tailBytes=262144'))`, feeds `http.get(client.send)` chunk stream through `parseSse`, each payload → `parseSessionLine` → `dedupe.firstOf` guard → `extractToolResult` into the map → `parsedLineToBubbles` append → `notifyListeners`, wrapped in `followSse` for reconnect (onReset does NOT clear the list). Page: `ListView` anchored to bottom on append; tool row tap → `model.toggle`; status glyph `!expanded || !toolResults.containsKey(id) ? '⏳' : (isError ? '✖' : '✔')`; result pane max-height scrollable `SelectableText`. Button 加载全部历史 only when `!fullHistory`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): session stream page with deduped tail render`.

### Task 10: Composer (409 force) + markdown rendering

**Files:**
- Create: `apps/mobile/lib/lib/post_events.dart`, `apps/mobile/lib/widgets/markdown_body.dart`
- Modify: `apps/mobile/lib/pages/session_page.dart` (composer + assistant markdown), `apps/mobile/pubspec.yaml` (markdown lib from spike)
- Test: `apps/mobile/test/lib/post_events_test.dart`, `apps/mobile/test/widgets/markdown_body_test.dart`
- Authority: `packages/pwa/src/lib/post-events.ts` (port), `packages/pwa/src/pages/SessionView.vue:77-101` (send/force flow)

**Interfaces:**
- Consumes: `ApiClient.ssePost` (Task 6), `TextBubble` (Task 3).
- Produces: `String? postEventError(Map<String, dynamic> event)` (null = not an error); `MarkdownBody(text)` widget for assistant bubbles.

- [ ] **Step 0 (spike, R1):** `flutter pub add markdown_widget` (or `flutter_markdown_plus` if the former is dead — check pub.dev publish date via `flutter pub deps`/pubspec resolved version); render a sample in the running app on Windows. If BOTH are dead/unusable, implement `MarkdownBody` as a minimal `**bold**`/`` `code` ``/heading-rich-text renderer and record the ruling in the ledger.
- [ ] **Step 1: Write the failing tests** — `post_events`: an error event (`{'type':'error', 'message': 'x'}` — read the TS for the exact shape) returns its message, others return null; `markdown_body`: pumping `MarkdownBody(text: 'hello **world**')` finds `hello` text and renders without exception; a `<script>` payload string renders as literal text (no `Html` widget path).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — composer: `TextField` + 发送 button → `client.ssePost('/api/sessions/$id/messages', {'text': text, 'force': force}, postEventError-collector)`; on `ApiError` 409 with `body['error'] == 'session_active'` show `AlertDialog` 会话近期仍有写入（可能本地 TUI 正在跑）。强制续聊？ → on confirm resend `force: true` (clear the input only on first attempt, mirror `send()`); other errors surface as a red `Text` line above the composer. Assistant `TextBubble` renders through `MarkdownBody`; user/tool/raw stay plain `SelectableText`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): composer with force confirm and markdown rendering`.

### Task 11: Approvals UI

**Files:**
- Create: `apps/mobile/lib/widgets/approval_card.dart`
- Modify: `apps/mobile/lib/pages/session_page.dart` (cards for the current session), `apps/mobile/lib/state/approvals_model.dart` (live stream hookup helper)
- Test: `apps/mobile/test/widgets/approval_card_test.dart`
- Authority: `packages/pwa/src/components/ApprovalCard.vue` + `SessionView.vue:61-72,129-133` (frame handling: `'toolName' in frame → ingest`, else `removeById`)

- [ ] **Step 1: Write the failing tests** — card renders `toolName` + input summary and calls `decide(id, 'allow'|'deny')` on the buttons; model fed a request frame ingests, a settled frame removes by id; a card whose POST fails stays visible (Task 7 semantics).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — session page opens `followSse` on `/api/approvals/stream` (token query param) dispatching frames as above, filtered to `frame.sessionId == null || frame.sessionId == current`; card layout: tool name bold, input JSON one-line ellipsized, 批准 (green) / 拒绝 (red) buttons; after `decide` resolves, `removeById` runs inside the model.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(mobile): approval cards with live settle handling`.

### Task 12: Cloud — FCM subscription store + route

**Files:**
- Create: `packages/cloud/src/push/fcm-store.ts`, `packages/cloud/src/api/fcm-routes.ts`
- Test: `packages/cloud/src/push/fcm-store.test.ts`, `packages/cloud/src/api/fcm-routes.test.ts`
- Authority (pattern): `packages/cloud/src/push/store.ts`, `packages/cloud/src/api/push-routes.ts`, and their tests

**Interfaces:**
- Produces: `interface FcmSubscription { clientId: string; platform: 'ios' | 'android'; token: string; createdAt: number }`; `class FcmStore { constructor(filePath: string | null); load(): Promise<void>; add(sub: FcmSubscription): Promise<void>; remove(token: string): Promise<void>; list(): FcmSubscription[] }` (keyed by `token`, atomic tmp+rename persist — same pattern as `store.ts`); `registerFcmRoutes(app, opts: { store: FcmStore; ready: boolean }): void` exposing `POST /api/push/native/subscribe` (400 `invalid_subscription` on bad body; 503 `push_not_configured` when `!ready`; 204 on upsert).

- [ ] **Step 1: Write the failing tests** — store: add→list→remove roundtrip against a tmp file; reload picks up persisted state; corrupt file starts empty. Routes: 400 on missing `clientId` / `platform` not in `{ios, android}` / short `fcmToken`; 503 when `!ready`; 204 + store updated on valid body; second POST with the same token updates `clientId`/`platform` without duplicating (upsert).
- [ ] **Step 2: Run — expect FAIL**: `pnpm --filter @ccferry/cloud exec vitest run src/push/fcm-store.test.ts`
- [ ] **Step 3: Implement** — mirror `store.ts`/`push-routes.ts` code style exactly (fastify typing, body casting, 204 `reply.code(204).send()`).
- [ ] **Step 4: Run — PASS**, full cloud suite green: `pnpm --filter @ccferry/cloud exec vitest run`
- [ ] **Step 5: Commit** `feat(cloud): fcm subscription store and native subscribe route`.

### Task 13: Cloud — native sender + wiring + deploy

**Files:**
- Create: `packages/cloud/src/push/fcm-sender.ts`
- Modify: `packages/cloud/src/push/sender.ts` (`PushSenderOptions` gains `native?: { store: FcmStore; send: (sub: FcmSubscription, payload: string) => Promise<void> }`; `deliver` loops web subs then FCM subs with the same suppression and dedup), `packages/cloud/src/app.ts` (wire `registerFcmRoutes` + build the real `send` behind `FCM_SERVICE_ACCOUNT` env via dynamic `import('firebase-admin/app')` + `import('firebase-admin/messaging')`; absent env → `ready: false`, sender omitted)
- Test: `packages/cloud/src/push/fcm-sender.test.ts` (+ extend `sender.test.ts`)
- Dependency: `pnpm --filter @ccferry/cloud add firebase-admin`

**Interfaces:**
- Consumes: `FcmStore` (Task 12), `attachPushSender` (existing).
- Produces: native delivery with identical payload JSON (`{title, body, sessionId?, force?}`) — the Flutter side reads `data` or `notification` fields from this.

- [ ] **Step 1: Write the failing tests** — with a fake `native.send`: an approval event delivers to both a web sub and an FCM sub; foreground FCM sub is suppressed unless `force`; a rejected send with `code = 'messaging/registration-token-not-registered'` removes exactly that FCM sub and still delivers to the others; `native` absent → zero FCM attempts and web path unchanged (existing tests still pass untouched).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `deliver` gains the second loop; error classification: `(error as {code?: string}).code === 'messaging/registration-token-not-registered'` → `store.remove(sub.token)` (mirror the 410 branch). `app.ts` wiring:

```ts
const fcmPath = process.env['FCM_SERVICE_ACCOUNT'];
const fcmStore = new FcmStore('/var/lib/ccferry/fcm-subscriptions.json');
await fcmStore.load();
const native = fcmPath
  ? {
      store: fcmStore,
      send: async (sub: FcmSubscription, payload: string): Promise<void> => {
        const { getApps, initializeApp } = await import('firebase-admin/app');
        const { getMessaging } = await import('firebase-admin/messaging');
        if (getApps().length === 0) initializeApp({ credential: (await import('firebase-admin/app')).cert(fcmPath) });
        const data = JSON.parse(payload) as Record<string, string>;
        await getMessaging().send({
          token: sub.token,
          notification: { title: data['title'] ?? '', body: data['body'] ?? '' },
          data: data,
        });
      },
    }
  : undefined;
```

`registerFcmRoutes(app, { store: fcmStore, ready: Boolean(native) })`; `attachPushSender(events, { ..., native })`.
- [ ] **Step 4: Run — PASS**, full monorepo suite green: `pnpm -r test` (excluding `apps/mobile`, which is not in the workspace) + `pnpm -r typecheck`.
- [ ] **Step 5: Deploy** — `scp -r packages/cloud/src/. root@39.105.92.24:/opt/ccferry/cloud/src/` then on the host `cd /opt/ccferry/cloud && pnpm install && sudo systemctl restart ccferry-cloud`; add `Environment=FCM_SERVICE_ACCOUNT=/root/.ccferry/fcm-service-account.json` to the unit (owner places that file; WITHOUT it the service must still boot — verify `journalctl -u ccferry-cloud -n 20` shows no FCM errors and `/api/push/native/subscribe` returns 503 until the file lands). Redeploy rules from `docs/notes/m4-findings.md` apply (never scp the unit with placeholders; re-run sed if any post-scp step fails).
- [ ] **Step 6: Commit** `feat(cloud): fcm native push delivery and wiring`.

### Task 14: Flutter push client + events stream

**Files:**
- Create: `apps/mobile/lib/push/push_service.dart`
- Modify: `apps/mobile/pubspec.yaml` (`firebase_core`, `firebase_messaging`), `apps/mobile/android/app/build.gradle` (conditional google-services plugin), `apps/mobile/lib/main.dart` (boot hook), `apps/mobile/lib/pages/session_page.dart` (notification-tap routing)
- Test: `apps/mobile/test/push/push_service_test.dart`
- Authority: Firebase config files are owner-provided, NEVER committed (Global Constraints)

**Interfaces:**
- Consumes: `ApiClient`, `AuthModel.clientId` (Tasks 6–7), cloud route (Task 12).
- Produces: `class PushService { Future<void> bootstrap({required ApiClient client, required String clientId}); void onTap(void Function(String sessionId) go); }` — permission request, `getToken`, `POST /api/push/native/subscribe {clientId, platform, fcmToken}`, tap routing from `getInitialMessage` + `onMessageOpenedApp`.

- [ ] **Step 1: Write the failing tests** (logic only, FCM behind an injected `TokenSource` interface): `bootstrap` posts the subscribe payload with the platform string for the current `Platform.operatingSystem` (`ios`/`android`); a rotated token re-posts on next bootstrap (upsert). The tap-callback registry maps `data['sessionId']` → `go`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `firebase_messaging` real calls live behind the seam; gradle applies `com.google.gms.google-services` only when `google-services.json` exists on disk (so Windows builds work before the owner drops the file in); after login the app also opens `followSse` on `/api/events/stream?clientId=<clientId>` — its `onLine` triggers `SessionsModel.refresh()` (list freshness) and its mere existence is what makes the cloud's `isForeground(clientId)` suppression work for the native client. Tap routes push-navigate to `/session/<sessionId>`, covering both cold (`getInitialMessage`) and warm (`onMessageOpenedApp`) starts.
- [ ] **Step 4: Run — PASS** (unit level), `flutter analyze` clean; real-device FCM verification is deferred to the acceptance checklist.
- [ ] **Step 5: Commit** `feat(mobile): fcm push registration and notification tap routing`.

### Task 15: iOS CI pipeline (R2 spike first)

**Files:**
- Create: `.github/workflows/ios.yml`, `apps/mobile/ios/ExportOptions.plist`

**Blockers (owner prerequisites, spec §11):** paid Apple Developer membership active, App Store Connect API key created, Firebase iOS app + APNs key uploaded, `GoogleService-Info.plist` available as a CI secret.

- [ ] **Step 1 (spike): minimal workflow, empty-ish app** — build and upload the scaffold to TestFlight before any refinement:

```yaml
# .github/workflows/ios.yml
name: ios-testflight
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '17' }
      - uses: subosito/flutter-action@v2
        with: { channel: stable }
      - run: flutter pub get
        working-directory: apps/mobile
      - name: Decode signing material
        env:
          P12_B64: ${{ secrets.IOS_DIST_P12_B64 }}
          MOBILEPROVISION_B64: ${{ secrets.IOS_DIST_MOBILEPROVISION_B64 }}
          ACS_KEY_JSON_B64: ${{ secrets.ACS_KEY_JSON_B64 }}
        run: |
          sec_dir="$RUNNER_TEMP/secrets"
          mkdir -p "$sec_dir"
          echo "$P12_B64" | base64 --decode > "$sec_dir/dist.p12"
          echo "$MOBILEPROVISION_B64" | base64 --decode > "$sec_dir/dist.mobileprovision"
          echo "$ACS_KEY_JSON_B64" | base64 --decode > "$sec_dir/acs.json"
      - name: Import cert + profile
        env:
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security import "$RUNNER_TEMP/secrets/dist.p12" -k build.keychain -P "$P12_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" build.keychain
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp "$RUNNER_TEMP/secrets/dist.mobileprovision" ~/Library/MobileDevice/Provisioning\ Profiles/
        env:
          P12_PASSWORD: ${{ secrets.IOS_DIST_P12_PASSWORD }}
      - name: Place firebase plist
        run: echo "${{ secrets.GOOGLE_SERVICE_INFO_PLIST_B64 }}" | base64 --decode > apps/mobile/ios/Runner/GoogleService-Info.plist
      - run: flutter build ipa --release --export-options-plist=ios/ExportOptions.plist
        working-directory: apps/mobile
        env:
          ACS_API_KEY_PATH: ${{ runner.temp }}/secrets/acs.json
      - name: Upload to TestFlight
        run: |
          ipa=$(ls build/ios/ipa/*.ipa | head -1)
          xcrun altool --upload-app -f "$ipa" -t ios \
            --apiKey "$ACS_KEY_ID" --apiIssuer "$ACS_ISSUER_ID"
        working-directory: apps/mobile
        env:
          ACS_KEY_ID: ${{ secrets.ACS_KEY_ID }}
          ACS_ISSUER_ID: ${{ secrets.ACS_ISSUER_ID }}
```

with `ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>TEAM_ID_FROM_OWNER</string>
  <key>signingCertificate</key><string>iPhone Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.fetaoily.ccferry</key><string>CCFERRY_PROFILE_NAME</string>
  </dict>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
```

`TEAM_ID_FROM_OWNER` / `CCFERRY_PROFILE_NAME` are filled from the owner's Apple portal values at execution time — they are identifiers, not secrets, and land in the repo only after the owner supplies them. `altool` upload requires the API key file at `./private_auth_keys/AuthKey_<KEY_ID>.p8` — the spike adds the step `mkdir -p private_auth_keys && cp "$RUNNER_TEMP/secrets/acs.p8" private_auth_keys/AuthKey_$ACS_KEY_ID.p8` if the first run reports it missing (expected on run 1; that is what the spike is for). Secrets to configure: `IOS_DIST_P12_B64`, `IOS_DIST_P12_PASSWORD`, `IOS_DIST_MOBILEPROVISION_B64`, `ACS_KEY_JSON_B64`, `ACS_KEY_ID`, `ACS_ISSUER_ID`, `KEYCHAIN_PASSWORD`, `GOOGLE_SERVICE_INFO_PLIST_B64`.

- [ ] **Step 2: Spike passes** — TestFlight shows the build; record actual runner minutes in the ledger (quota math per spec §8). Fix only what the run proves broken; no speculative hardening.
- [ ] **Step 3: Point the workflow at the real app** (it already is — the spike runs the same yaml; if the spike needed a stub plist, restore the real one now) and verify one full build with `firebase_messaging` present.
- [ ] **Step 4: Commit** `ci(mobile): testflight pipeline for ios`.

---

## Verification (end of plan)

- `pnpm -r test` + `pnpm -r typecheck` green (4 TS packages); `cd apps/mobile && flutter test && flutter analyze` green.
- Cloud deployed with `FCM_SERVICE_ACCOUNT` set; `POST /api/push/native/subscribe` returns 204 through the tunnel.
- Owner acceptance (spec §10): TestFlight install → 4G 熄屏 push arrival → tap-through to the session page; Android APK equivalent; TestFlight 90-day rebuild drill.

## Self-Review

1. **Spec coverage:** v1 scope items 1–6 → Tasks 8 (login), 8 (list), 9 (stream), 10 (chat), 11 (approvals), 12–14 (push + tap-through); §7 key discipline → Tasks 13–14; §8 build/distribute → Task 15; §9 risks R1 → Task 10 spike, R2 → Task 15 spike, R3 → manual-dispatch trigger, R4 → Task 2; §10 tests → mirrored per task; §11 owner actions → Task 15 blockers. No gaps.
2. **Placeholder scan:** none — `TEAM_ID_FROM_OWNER`/`CCFERRY_PROFILE_NAME` are owner-supplied identifier values with a named source, not unwritten design.
3. **Type consistency:** `ParsedLine`/`Bubble`/`ToolPair`/`FcmSubscription` signatures match across Tasks 2→3→9 and 12→13; `ApiClient` methods match Tasks 7→9→10→14; `FollowHandle`/`followSse` options match Tasks 5→9→11→14.
4. **Review Focus:** inputs 1–5 pinned by Tasks 2, 5, 3, 10, 13 respectively.

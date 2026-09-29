import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/session/session_status.dart';

SessionSummary session({required int lastModifiedMs}) => SessionSummary(
      sessionId: 's1',
      projectPath: '/p',
      file: 'f.jsonl',
      sizeBytes: 1,
      lastModifiedMs: lastModifiedMs,
      firstUserText: 'x',
    );

ToolApprovalRequest approval({String? sessionId}) => ToolApprovalRequest(
      approvalId: 'a1',
      sessionId: sessionId,
      toolName: 'Bash',
      input: {},
      createdAtMs: 0,
      timeoutMs: 600000,
    );

void main() {
  test('awaiting when an approval targets the session', () {
    final s = session(lastModifiedMs: 0);
    final now = DateTime.fromMillisecondsSinceEpoch(500000);
    expect(sessionStatus(s, now, [approval(sessionId: 's1')]), 'awaiting');
  });

  test('running inside the activity window, idle outside', () {
    final now = DateTime.fromMillisecondsSinceEpoch(200000);
    expect(sessionStatus(session(lastModifiedMs: 150000), now, const []), 'running');
    expect(sessionStatus(session(lastModifiedMs: 50000), now, const []), 'idle');
  });

  test('approvals for other sessions do not change the status', () {
    final now = DateTime.fromMillisecondsSinceEpoch(500000);
    expect(sessionStatus(session(lastModifiedMs: 0), now, [approval(sessionId: 'other')]), 'idle');
  });
}

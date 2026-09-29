import 'package:ccferry_mobile/protocol/events.dart';

// Same activity window the daemon-side guard uses (pwa session-status.ts).
const activityWindowMs = 120000;

String sessionStatus(
  SessionSummary s,
  DateTime now,
  List<ToolApprovalRequest> approvals,
) {
  if (approvals.any((a) => a.sessionId == s.sessionId)) return 'awaiting';
  if (now.millisecondsSinceEpoch - s.lastModifiedMs < activityWindowMs) {
    return 'running';
  }
  return 'idle';
}

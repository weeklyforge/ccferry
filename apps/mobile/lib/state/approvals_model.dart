import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/protocol/events.dart';

// Port of pwa stores/approvals.ts. The card leaves the list only after the
// decision POST succeeds: a dropped decision would look granted while the
// tool times out into a deny.
class ApprovalsModel extends ChangeNotifier {
  ApprovalsModel({required this.client});

  final ApiClient client;

  final List<ToolApprovalRequest> _pending = [];
  List<ToolApprovalRequest> get pending => List.unmodifiable(_pending);

  void ingest(ToolApprovalRequest request) {
    if (!_pending.any((p) => p.approvalId == request.approvalId)) {
      _pending.add(request);
      notifyListeners();
    }
  }

  void removeById(String approvalId) {
    _pending.removeWhere((p) => p.approvalId == approvalId);
    notifyListeners();
  }

  Future<void> decide(String approvalId, String decision) async {
    await client.postJson('/api/approvals/$approvalId/decision', {'decision': decision});
    removeById(approvalId);
  }

  void sweepExpired(DateTime now) {
    final nowMs = now.millisecondsSinceEpoch;
    _pending.removeWhere((p) => nowMs - p.createdAtMs >= p.timeoutMs);
    notifyListeners();
  }

  /// Applies a frame from /api/approvals/stream: request frames ingest,
  /// settled frames drop the card (decided elsewhere or timed out).
  void handleFrame(Map<String, dynamic> frame) {
    if (frame['toolName'] != null) {
      ingest(ToolApprovalRequest.fromJson(frame));
    } else if (frame['approvalId'] != null) {
      removeById(frame['approvalId'] as String);
    }
  }
}

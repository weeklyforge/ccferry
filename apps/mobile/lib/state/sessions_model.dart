import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';

// The overview/history/new-task pages lead with the project NAME; the full
// path is secondary context. Handles both Windows and posix separators and
// ignores trailing separators.
String shortProject(String path) {
  final segments = path.split(RegExp(r'[\\/]')).where((s) => s.isNotEmpty).toList();
  return segments.isEmpty ? path : segments.last;
}

class ProjectGroup {
  const ProjectGroup({required this.projectPath, required this.shortName, required this.list});
  final String projectPath, shortName;
  final List<SessionSummary> list;
}

class SessionsModel extends ChangeNotifier {
  SessionsModel({required this.client, required this.approvals});

  final ApiClient client;
  final ApprovalsModel approvals;

  List<SessionSummary> _sessions = [];
  List<SessionSummary> get sessions => List.unmodifiable(_sessions);
  bool unauthorized = false;
  bool loading = true;

  List<ProjectGroup> get groups {
    final order = <String>[];
    final map = <String, List<SessionSummary>>{};
    for (final s in _sessions) {
      final list = map.putIfAbsent(s.projectPath, () {
        order.add(s.projectPath);
        return <SessionSummary>[];
      });
      list.add(s);
    }
    return [
      for (final path in order)
        ProjectGroup(projectPath: path, shortName: shortProject(path), list: map[path]!),
    ];
  }

  Future<void> refresh() async {
    approvals.sweepExpired(DateTime.now());
    try {
      final res = await client.getJson('/api/sessions');
      _sessions = [
        for (final item in res as List) SessionSummary.fromJson((item as Map).cast<String, dynamic>()),
      ];
      unauthorized = false;
    } on ApiError catch (e) {
      if (e.status == 401) unauthorized = true;
    } catch (_) {
      // network failure — keep the previous list
    }
    loading = false;
    try {
      final res = await client.getJson('/api/approvals');
      for (final item in (res as Map)['approvals'] as List) {
        approvals.ingest(ToolApprovalRequest.fromJson((item as Map).cast<String, dynamic>()));
      }
    } catch (_) {
      // approvals are auxiliary to the list — never block the render
    }
    notifyListeners();
  }
}

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/vault/vault_types.dart';

enum VaultPhase { idle, loading, ready, notConfigured, failed }

// Read-only vault state: tree browse + full-text search + note reading.
// The tree refreshes on every page entry; an already-loaded tree is never
// swapped for a spinner (spec D4).
class VaultModel extends ChangeNotifier {
  VaultModel({required this.client, this.debounce = const Duration(milliseconds: 300)});

  final ApiClient client;
  final Duration debounce;

  VaultPhase phase = VaultPhase.idle;
  List<VaultNode> tree = const [];
  bool searching = false;
  String query = '';
  List<VaultSearchMatch> matches = const [];
  bool searchFailed = false;

  Timer? _timer;
  int _searchSeq = 0;

  Future<void> refresh() async {
    // Keep the previous screen alive on a background refresh (D4).
    final keepOld = phase == VaultPhase.ready || phase == VaultPhase.notConfigured;
    if (!keepOld) {
      phase = VaultPhase.loading;
      notifyListeners();
    }
    try {
      final res = await client.getJson('/api/vault/tree') as Map;
      tree = [
        for (final n in (res['tree'] as List))
          if (n is Map<String, dynamic>) ...[
            ?VaultNode.tryFromJson(n),
          ],
      ];
      phase = VaultPhase.ready;
    } on ApiError catch (e) {
      phase = e.status == 503 ? VaultPhase.notConfigured : VaultPhase.failed;
    } catch (_) {
      phase = VaultPhase.failed;
    }
    notifyListeners();
  }

  void search(String q) {
    _timer?.cancel();
    query = q;
    _searchSeq++; // any state change invalidates in-flight requests
    if (q.trim().isEmpty) {
      searching = false;
      searchFailed = false;
      matches = const [];
      notifyListeners();
      return;
    }
    searching = true;
    notifyListeners();
    _timer = Timer(debounce, () => _runSearch(q, _searchSeq));
  }

  Future<void> _runSearch(String q, int seq) async {
    try {
      final res = await client.getJsonQuery('/api/vault/search', {'q': q}) as Map;
      if (seq != _searchSeq) return; // a newer query superseded this one
      matches = [
        for (final m in (res['matches'] as List))
          if (m is Map<String, dynamic>) VaultSearchMatch.fromJson(m),
      ];
      searchFailed = false;
    } catch (_) {
      if (seq != _searchSeq) return;
      searchFailed = true;
    }
    searching = false;
    notifyListeners();
  }

  Future<String> readNote(String path) async {
    final res = await client.getJsonQuery('/api/vault/file', {'path': path}) as Map;
    return res['content'] as String? ?? '';
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

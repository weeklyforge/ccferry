import 'dart:async';
import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

ApiClient clientOf(Future<http.Response> Function(http.Request) handler) => ApiClient(
      client: MockClient(handler),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );

http.Response treeResponse(String marker) => http.Response(
      jsonEncode({
        'root': '/v',
        'tree': [
          {'name': marker, 'path': marker, 'kind': 'file', 'sizeBytes': 1},
        ],
      }),
      200,
    );

void main() {
  test('refresh parses the tree and lands on ready', () async {
    final model = VaultModel(client: clientOf((req) async => treeResponse('a.md')));
    await model.refresh();
    expect(model.phase, VaultPhase.ready);
    expect(model.tree.single.name, 'a.md');
  });

  test('503 maps to notConfigured', () async {
    final model = VaultModel(client: clientOf(
      (req) async => http.Response(jsonEncode({'error': 'vault_not_configured'}), 503),
    ));
    await model.refresh();
    expect(model.phase, VaultPhase.notConfigured);
  });

  test('network failure maps to failed, then retry recovers', () async {
    var down = true;
    final model = VaultModel(client: clientOf((req) async {
      if (down) throw Exception('offline');
      return treeResponse('a.md');
    }));
    await model.refresh();
    expect(model.phase, VaultPhase.failed);
    down = false;
    await model.refresh();
    expect(model.phase, VaultPhase.ready);
  });

  test('refresh on ready keeps the old tree visible (no loading flip)', () async {
    var marker = 'a.md';
    final model = VaultModel(client: clientOf((req) async {
      await Future<void>.delayed(const Duration(milliseconds: 10));
      return treeResponse(marker);
    }));
    await model.refresh();
    expect(model.phase, VaultPhase.ready);
    final seen = <VaultPhase>[];
    model.addListener(() => seen.add(model.phase));
    marker = 'b.md';
    await model.refresh();
    expect(model.tree.single.name, 'b.md');
    expect(seen, isNotEmpty);
    expect(seen, everyElement(VaultPhase.ready)); // loading was never announced
  });

  test('debounced search fires once with the last query', () {
    final queries = <String>[];
    final model = VaultModel(client: clientOf((req) async {
      queries.add(req.url.queryParameters['q']!);
      return http.Response(jsonEncode({'matches': []}), 200);
    }));
    fakeAsync((async) {
      model.search('资源');
      async.elapse(const Duration(milliseconds: 100));
      model.search('资源 计划');
      expect(queries, isEmpty); // debounce holds, searching is on
      expect(model.searching, isTrue);
      async.elapse(const Duration(milliseconds: 300));
      expect(queries, ['资源 计划']);
    });
  });

  test('empty query clears results and fires no request', () {
    var calls = 0;
    final model = VaultModel(client: clientOf((req) async {
      calls++;
      return http.Response(jsonEncode({'matches': []}), 200);
    }));
    fakeAsync((async) {
      model.search('x');
      async.elapse(const Duration(milliseconds: 300));
      expect(calls, 1);
      model.search('');
      expect(model.query, '');
      expect(model.matches, isEmpty);
      expect(model.searching, isFalse);
      async.elapse(const Duration(milliseconds: 300));
      expect(calls, 1); // no request for the empty query
    });
  });

  test('a slow older response never overwrites the newer results', () {
    final pending = <Completer<http.Response>>[];
    final model = VaultModel(client: clientOf((req) async {
      final c = Completer<http.Response>();
      pending.add(c);
      return c.future;
    }));
    fakeAsync((async) {
      model.search('a');
      async.elapse(const Duration(milliseconds: 300));
      model.search('ab');
      async.elapse(const Duration(milliseconds: 300));
      expect(pending.length, 2);
      pending[0].complete(http.Response(
        jsonEncode({'matches': [
          {'path': 'old.md', 'line': 1, 'text': 'a'},
        ]}),
        200,
      ));
      async.elapse(const Duration(milliseconds: 1));
      expect(model.matches, isEmpty); // stale response dropped
      expect(model.searching, isTrue);
      pending[1].complete(http.Response(
        jsonEncode({'matches': [
          {'path': 'new.md', 'line': 2, 'text': 'ab'},
        ]}),
        200,
      ));
      async.elapse(const Duration(milliseconds: 1));
      expect(model.searching, isFalse);
      expect(model.matches.single.path, 'new.md');
    });
  });

  test('search failure flags searchFailed and keeps the query', () {
    final model = VaultModel(client: clientOf((req) async => throw Exception('offline')));
    fakeAsync((async) {
      model.search('x');
      async.elapse(const Duration(milliseconds: 300));
      async.flushMicrotasks();
      expect(model.searchFailed, isTrue);
      expect(model.query, 'x');
    });
  });

  test('readNote returns the content', () async {
    final model = VaultModel(client: clientOf((req) async {
      expect(req.url.queryParameters['path'], '项目管理/索引.md');
      // Response(String) defaults to latin1 — Chinese bodies need utf8 bytes.
      return http.Response.bytes(utf8.encode(jsonEncode({'path': '项目管理/索引.md', 'content': '# hi'})), 200);
    }));
    expect(await model.readNote('项目管理/索引.md'), '# hi');
  });
}

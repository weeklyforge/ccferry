# Flutter 知识库查询（只读）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机 App 内三步直达任意笔记——会话页知识库图标 → 浏览/搜索定位 → 阅读 md 全文（只读，零后端改动）。

**Architecture:** 新增 `lib/vault/`（wire 类型 + ChangeNotifier 模型）与两个页面（VaultPage 浏览+搜索、NotePage 阅读），全部经注入的 ApiClient 消费 daemon 既有 `/api/vault/tree|file|search`；`/vault`、`/note` 推在 root navigator 上，路由 builder 内以 `.value` 直供 provider。

**Tech Stack:** Flutter 3.44.8（`PopScope.onPopInvokedWithResult` 可用）、provider、http/MockClient、markdown_widget（复用既有 `MarkdownBody`）、flutter_test + fake_async。

**Spec:** `docs/superpowers/specs/2026-09-30-flutter-vault-query-design.md`（契约以 spec §3 为准，冲突处以 spec 为准）

## Global Constraints

- 代码与注释英文；UI 文案中文（仓库硬规则）。
- 零后端改动：只消费 `GET /api/vault/tree`、`GET /api/vault/file?path=`、`GET /api/vault/search?q=`；写路由绝不触碰。
- 所有 vault file/search 请求必须走 `getJsonQuery`（Uri queryParameters 编码），绝不手工字符串拼接 query（中文/空格路径）。
- 提交：conventional subject + markdown 无序列表正文；不加 Co-Authored-By；**只 commit，绝不 push**。
- 所有命令在 `apps/mobile` 下执行（cwd 会漂移，每条命令显式 `cd`）。
- 每任务收尾双绿：`flutter test`（全量）+ `flutter analyze`（零 issue）。

## Review Focus

spec 隐含但常规测试不覆盖、最可能咬到使用者的失败类（每条已把测试钉进所属任务）：

1. **vault 未配置（503 `vault_not_configured`）** → 全页「知识库未配置」空态，不崩溃、不发重试循环。钉：Task 3 `503 maps to notConfigured`；Task 5 `shows the not-configured empty state`。
2. **中文/空格路径与查询词** → 必须编码后到达服务端（`?path=项目管理/索引.md` 不可裸拼）。钉：Task 2 `getJsonQuery encodes chinese and space query values`。
3. **树里的坏节点**（缺 name/path、kind 未知、children 缺失）→ 该节点丢弃、整树照常渲染。钉：Task 1 `drops malformed nodes and tolerates missing children`。
4. **防抖连击与慢响应竞态** → 连续输入只发末次请求；先完成的旧响应不得覆盖新结果。钉：Task 3 `debounced search fires once with the last query` + `a slow older response never overwrites the newer results`。
5. **单层大目录（数百项）** → `ListView.builder` 惰性构建 + `AlwaysScrollableScrollPhysics`（短列表也要能下拉刷新），滚动可达最后一项。钉：Task 4 `renders a large level lazily and stays pull-to-refreshable`。

---

### Task 1: Vault wire 类型

**Files:**
- Create: `apps/mobile/lib/vault/vault_types.dart`
- Test: `apps/mobile/test/vault/vault_types_test.dart`

**Interfaces:**
- Consumes: 无。
- Produces（后续任务逐字使用）:
  - `class VaultNode`：`String name, path`、`String kind`（'file'|'dir'）、`int? sizeBytes`、`List<VaultNode> children`（永不为 null）；`static VaultNode? tryFromJson(Map<String, dynamic> j)`——name/path 非 String 或 kind ∉ {file,dir} 返回 null（节点丢弃），children 逐项 tryFromJson 并过滤 null。
  - `class VaultSearchMatch`：`String path, text`、`int line`；`factory VaultSearchMatch.fromJson(Map<String, dynamic> j)`（服务端可信，硬转型，风格同 `SessionSummary.fromJson`）。

- [ ] **Step 1: Write the failing test**

```dart
// apps/mobile/test/vault/vault_types_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/vault/vault_types.dart';

void main() {
  test('parses a dir with children and a file with size', () {
    final node = VaultNode.tryFromJson(const {
      'name': '项目管理',
      'path': '项目管理',
      'kind': 'dir',
      'children': [
        {'name': '索引.md', 'path': '项目管理/索引.md', 'kind': 'file', 'sizeBytes': 12},
      ],
    });
    expect(node, isNotNull);
    expect(node!.kind, 'dir');
    expect(node.sizeBytes, isNull);
    expect(node.children.single.name, '索引.md');
    expect(node.children.single.sizeBytes, 12);
  });

  test('drops malformed nodes and tolerates missing children', () {
    expect(VaultNode.tryFromJson(const {'path': 'x', 'kind': 'file'}), isNull);
    expect(VaultNode.tryFromJson(const {'name': 'x', 'path': 'x', 'kind': 'symlink'}), isNull);
    final bare = VaultNode.tryFromJson(const {'name': 'x', 'path': 'x', 'kind': 'dir'});
    expect(bare!.children, isEmpty);
  });

  test('filters null children out of a mixed list', () {
    final node = VaultNode.tryFromJson(const {
      'name': 'd',
      'path': 'd',
      'kind': 'dir',
      'children': [
        {'name': 'ok.md', 'path': 'd/ok.md', 'kind': 'file'},
        {'kind': 'file'},
      ],
    });
    expect(node!.children.single.name, 'ok.md');
  });

  test('parses a search match', () {
    final m = VaultSearchMatch.fromJson(const {'path': 'a/b.md', 'line': 3, 'text': 'needle here'});
    expect(m.path, 'a/b.md');
    expect(m.line, 3);
    expect(m.text, 'needle here');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/vault/vault_types_test.dart`
Expected: FAIL — `vault_types.dart` 不存在（import 编译错误）。

- [ ] **Step 3: Write minimal implementation**

```dart
// apps/mobile/lib/vault/vault_types.dart
// Wire types of the daemon vault service (M2 /api/vault/*), mirrored in Dart.
// The tree may contain junk rows; a malformed node is dropped, never fatal.

class VaultNode {
  const VaultNode({
    required this.name,
    required this.path,
    required this.kind,
    this.sizeBytes,
    this.children = const [],
  });

  static VaultNode? tryFromJson(Map<String, dynamic> j) {
    final name = j['name'];
    final path = j['path'];
    final kind = j['kind'];
    if (name is! String || path is! String || (kind != 'file' && kind != 'dir')) {
      return null;
    }
    final rawChildren = j['children'];
    final children = rawChildren is List
        ? [
            for (final c in rawChildren)
              if (c is Map<String, dynamic>) ...[
                ?tryFromJson(c),
              ],
          ]
        : const <VaultNode>[];
    return VaultNode(
      name: name,
      path: path,
      kind: kind as String,
      sizeBytes: (j['sizeBytes'] as num?)?.toInt(),
      children: children,
    );
  }

  final String name, path, kind;
  final int? sizeBytes;
  final List<VaultNode> children;
}

class VaultSearchMatch {
  const VaultSearchMatch({required this.path, required this.line, required this.text});

  factory VaultSearchMatch.fromJson(Map<String, dynamic> j) => VaultSearchMatch(
        path: j['path'] as String,
        line: (j['line'] as num).toInt(),
        text: j['text'] as String? ?? '',
      );

  final String path, text;
  final int line;
}
```

注意：`?tryFromJson(c)` 为 null-aware 元素（Dart 3.8+）；若 analyze 报语法错，改为 `for (final c in rawChildren) { final n = c is Map<String, dynamic> ? tryFromJson(c) : null; if (n != null) children2.add(n); }` 的显式收集写法。以 analyze 零 issue 为准。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/vault/vault_types_test.dart`
Expected: PASS 4/4。

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git add lib/vault/vault_types.dart test/vault/vault_types_test.dart && git commit -F - <<'EOF'
feat(mobile): add vault wire types

- VaultNode.tryFromJson drops malformed rows and tolerates missing children
- VaultSearchMatch.fromJson mirrors the trusted search payload
- tests pin the drop-not-crash contract for junk tree rows
EOF
```

---

### Task 2: ApiClient 带 query 的 GET

**Files:**
- Modify: `apps/mobile/lib/net/api_client.dart`（在 `getJson` 后新增方法）
- Test: `apps/mobile/test/net/api_client_test.dart`（追加两个用例）

**Interfaces:**
- Consumes: 既有 `ApiClient._uri/_authHeaders/_decodeOrThrow`。
- Produces: `Future<dynamic> getJsonQuery(String path, Map<String, String> query)` —— 语义与 `getJson` 完全一致（Bearer、非 200 抛 `ApiError`、JSON 解码），URL 为 `_uri(path).replace(queryParameters: query)`。

- [ ] **Step 1: Write the failing test**（追加进 `test/net/api_client_test.dart` 的 `main` 内）

```dart
  test('getJsonQuery encodes chinese and space query values', () async {
    http.BaseRequest? seen;
    final client = ApiClient(
      client: MockClient((req) async {
        seen = req;
        return http.Response(jsonEncode({'path': 'a', 'content': 'x'}), 200);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await client.getJsonQuery('/api/vault/file', {'path': '项目管理/热力 索引.md'});
    expect(seen!.url.path, '/api/vault/file');
    expect(seen!.url.queryParameters['path'], '项目管理/热力 索引.md');
    expect(seen!.url.toString(), isNot(contains(' '))); // raw value never leaks unencoded
    expect(seen!.headers['Authorization'], 'Bearer tok');
  });

  test('getJsonQuery throws ApiError on 503', () async {
    final client = ApiClient(
      client: MockClient((req) async => http.Response(jsonEncode({'error': 'vault_not_configured'}), 503)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await expectLater(
      client.getJsonQuery('/api/vault/tree', {}),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 503)),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/net/api_client_test.dart`
Expected: FAIL — `getJsonQuery` 未定义。

- [ ] **Step 3: Write minimal implementation**（`getJson` 之后插入）

```dart
  /// GETs with encoded query params. Vault paths and search terms carry
  /// Chinese and spaces — never hand-concatenate them into the path string.
  Future<dynamic> getJsonQuery(String path, Map<String, String> query) async {
    final req = http.Request('GET', _uri(path).replace(queryParameters: query))
      ..headers.addAll(_authHeaders());
    final res = await http.Response.fromStream(await client.send(req));
    return _decodeOrThrow(res);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/net/api_client_test.dart`
Expected: PASS 8/8。

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git add lib/net/api_client.dart test/net/api_client_test.dart && git commit -F - <<'EOF'
feat(mobile): add query-param get to the api client

- getJsonQuery encodes values through Uri queryParameters
- same bearer and ApiError semantics as getJson
- tests pin chinese/space encoding and the 503 passthrough
EOF
```

---

### Task 3: VaultModel

**Files:**
- Create: `apps/mobile/lib/vault/vault_model.dart`
- Test: `apps/mobile/test/vault/vault_model_test.dart`

**Interfaces:**
- Consumes: Task 1 `VaultNode.tryFromJson` / `VaultSearchMatch.fromJson`；Task 2 `getJsonQuery`；既有 `ApiClient.getJson`（树走它，无参数）。
- Produces:
  - `enum VaultPhase { idle, loading, ready, notConfigured, failed }`
  - `VaultModel({required ApiClient client, Duration debounce = const Duration(milliseconds: 300)})` extends ChangeNotifier
  - 字段：`VaultPhase phase`、`List<VaultNode> tree`、`bool searching`、`String query`、`List<VaultSearchMatch> matches`、`bool searchFailed`
  - `Future<void> refresh()`：phase ∈ {ready, notConfigured} 时不置 loading（旧树原地刷新，不发 loading 通知）；503→notConfigured，其他 ApiError/异常→failed
  - `void search(String q)`：空 q 立即清结果且不发请求；否则 300ms 防抖后 GET `/api/vault/search`；序号守卫——旧响应不得覆盖新查询
  - `Future<String> readNote(String path)`：GET `/api/vault/file`，返回 content（ApiError 上抛）
  - `dispose()` 取消防抖 Timer

- [ ] **Step 1: Write the failing test**

```dart
// apps/mobile/test/vault/vault_model_test.dart
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

  test('search failure flags searchFailed and keeps the query', () async {
    final model = VaultModel(client: clientOf((req) async => throw Exception('offline')));
    fakeAsync((async) {
      model.search('x');
      async.elapse(const Duration(milliseconds: 300));
    });
    await Future<void>.delayed(Duration.zero);
    expect(model.searchFailed, isTrue);
    expect(model.query, 'x');
  });

  test('readNote returns the content', () async {
    final model = VaultModel(client: clientOf((req) async {
      expect(req.url.queryParameters['path'], '项目管理/索引.md');
      return http.Response(jsonEncode({'path': '项目管理/索引.md', 'content': '# hi'}), 200);
    }));
    expect(await model.readNote('项目管理/索引.md'), '# hi');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/vault/vault_model_test.dart`
Expected: FAIL — `vault_model.dart` 不存在。

- [ ] **Step 3: Write minimal implementation**

```dart
// apps/mobile/lib/vault/vault_model.dart
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
          if (n is Map<String, dynamic>)
            ...[
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
```

（同 Task 1 注意：`?VaultNode.tryFromJson(n)` 若版本不识别则用显式收集写法；以 analyze 零 issue 为准。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/vault/vault_model_test.dart`
Expected: PASS 9/9。

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git add lib/vault/vault_model.dart test/vault/vault_model_test.dart && git commit -F - <<'EOF'
feat(mobile): add the vault model

- refresh keeps an already-loaded tree on screen instead of a spinner
- 503 maps to notConfigured, transport errors to failed with retry
- search debounces 300ms, drops stale responses via a sequence guard
- empty queries clear results without a request
EOF
```

---

### Task 4: VaultPage 浏览（树/下钻/返回/下拉刷新）

**Files:**
- Create: `apps/mobile/lib/pages/vault_page.dart`
- Test: `apps/mobile/test/pages/vault_page_test.dart`

**Interfaces:**
- Consumes: Task 3 的 `VaultModel`/`VaultPhase`/`VaultNode`；`provider`。
- Produces: `class VaultPage extends StatefulWidget { const VaultPage({super.key}); }`（路由名 `/vault`；点击文件 `pushNamed('/note', arguments: node.path)`——Task 6/7 接）；页内测试 harness（本任务建，Task 5 复用）。

- [ ] **Step 1: Write the failing test**

```dart
// apps/mobile/test/pages/vault_page_test.dart
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/vault_page.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

http.Response treeResponse({int files = 1}) => http.Response(
      jsonEncode({
        'root': '/v',
        'tree': [
          {
            'name': '项目管理',
            'path': '项目管理',
            'kind': 'dir',
            'children': [
              {'name': '索引.md', 'path': '项目管理/索引.md', 'kind': 'file', 'sizeBytes': 12},
            ],
          },
          for (var i = 0; i < files; i++)
            {'name': 'f$i.md', 'path': 'f$i.md', 'kind': 'file', 'sizeBytes': i},
        ],
      }),
      200,
    );

ApiClient vaultClient({int treeHits = 0}) => ApiClient(
      client: MockClient((req) async {
        if (req.url.path == '/api/vault/tree') {
          treeHits++;
          return treeResponse();
        }
        return http.Response(jsonEncode({}), 404);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );

Widget harness(ApiClient client, {VaultModel? model, RouteFactory? onGenerateRoute}) =>
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: client),
        ChangeNotifierProvider<VaultModel>.value(value: model ?? VaultModel(client: client)),
      ],
      child: MaterialApp(home: const VaultPage(), onGenerateRoute: onGenerateRoute),
    );

void main() {
  testWidgets('renders the root level with dirs before files', (tester) async {
    await tester.pumpWidget(harness(vaultClient()));
    await tester.pumpAndSettle();

    final dirY = tester.getTopLeft(find.text('项目管理')).dy;
    final fileY = tester.getTopLeft(find.text('f0.md')).dy;
    expect(dirY, lessThan(fileY));
    expect(find.text('知识库'), findsOneWidget); // root title
  });

  testWidgets('drills into a dir and the back button pops one level', (tester) async {
    await tester.pumpWidget(harness(vaultClient()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('项目管理'));
    await tester.pumpAndSettle();
    expect(find.text('项目管理'), findsNWidgets(2)); // appbar title + row
    expect(find.text('索引.md'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('f0.md'), findsOneWidget); // back at root
    expect(find.byType(BackButton), findsNothing);
  });

  testWidgets('system back pops one level before leaving the page', (tester) async {
    await tester.pumpWidget(harness(vaultClient()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('项目管理'));
    await tester.pumpAndSettle();
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    await navigator.maybePop();
    await tester.pumpAndSettle();
    expect(find.text('知识库'), findsOneWidget); // still on the vault page, back at root
    expect(find.text('f0.md'), findsOneWidget);
  });

  testWidgets('tapping a file pushes /note with its path', (tester) async {
    final pushed = <String?>[];
    await tester.pumpWidget(harness(
      vaultClient(),
      onGenerateRoute: (s) {
        pushed.add(s.name);
        return MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('NOTE')));
      },
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('索引.md'));
    await tester.pumpAndSettle();
    expect(pushed.last, '/note');
    expect(find.text('NOTE'), findsOneWidget);
  });

  testWidgets('refreshes the tree on entry and on pull-to-refresh', (tester) async {
    final client = vaultClient();
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();
    final hits1 = client.treeHitsLocal;
    expect(hits1, 1); // entry refresh

    await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
    await tester.pumpAndSettle();
    expect(client.treeHitsLocal, greaterThan(hits1)); // pull-to-refresh refetch
  });

  testWidgets('renders a large level lazily and stays pull-to-refreshable', (tester) async {
    final client = ApiClient(
      client: MockClient((req) async => treeResponse(files: 500)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();

    expect(find.text('f499.md'), findsNothing); // builder has not built the tail
    await tester.dragUntilVisible(find.text('f499.md'), find.byType(ListView), const Offset(0, -200));
    expect(find.text('f499.md'), findsOneWidget);

    await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
    await tester.pumpAndSettle(); // completes without throwing: refresh works on a long list
  });
}
```

注意 `treeHits` 计数：`vaultClient` 的参数 `treeHits` 应实现为可读字段（如 `class CountingClient extends ...` 或把 handler 闭包的计数暴露为 getter `treeHitsLocal`）——实现时用最小写法：自定义一个带 `int treeHitsLocal = 0` 字段的包装即可，测试代码允许此类小支架。上面 `vaultClient({int treeHits = 0})` 签名仅为示意，落地时改为 `vaultClient()` + 公开 `treeHitsLocal`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/pages/vault_page_test.dart`
Expected: FAIL — `vault_page.dart` 不存在。

- [ ] **Step 3: Write minimal implementation**

```dart
// apps/mobile/lib/pages/vault_page.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/vault/vault_model.dart';
import 'package:ccferry_mobile/vault/vault_types.dart';

class VaultPage extends StatefulWidget {
  const VaultPage({super.key});

  @override
  State<VaultPage> createState() => _VaultPageState();
}

class _VaultPageState extends State<VaultPage> {
  final List<String> _stack = [];
  final TextEditingController _query = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Refresh on every entry (spec D4); an old tree stays visible meanwhile.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<VaultModel>().refresh();
    });
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _drill(String segment) => setState(() => _stack.add(segment));

  void _up() {
    if (_stack.isNotEmpty) setState(() => _stack.removeLast());
  }

  List<VaultNode> _childrenOf(List<VaultNode> tree) {
    var level = tree;
    for (final segment in _stack) {
      VaultNode? dir;
      for (final n in level) {
        if (n.kind == 'dir' && n.name == segment) {
          dir = n;
          break;
        }
      }
      if (dir == null) return const [];
      level = dir.children;
    }
    final dirs = level.where((n) => n.kind == 'dir').toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    final files = level.where((n) => n.kind == 'file').toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    return [...dirs, ...files]; // dirs first (spec D6)
  }

  @override
  Widget build(BuildContext context) {
    final vault = context.watch<VaultModel>();
    return PopScope(
      canPop: _stack.isEmpty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _up();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_stack.isEmpty ? '知识库' : _stack.last),
          leading: _stack.isEmpty ? null : BackButton(onPressed: _up),
        ),
        body: _body(vault),
      ),
    );
  }

  Widget _body(VaultModel vault) {
    if (vault.phase == VaultPhase.notConfigured) {
      return const Center(child: Text('知识库未配置'));
    }
    if (vault.phase == VaultPhase.failed && vault.tree.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('加载失败'),
            TextButton(onPressed: vault.refresh, child: const Text('重试')),
          ],
        ),
      );
    }
    if (vault.phase == VaultPhase.loading && vault.tree.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            controller: _query,
            decoration: const InputDecoration(
              hintText: '搜索知识库',
              prefixIcon: Icon(Icons.search),
              isDense: true,
            ),
            onChanged: vault.search,
          ),
        ),
        Expanded(child: vault.query.trim().isEmpty ? _browseList(vault) : _searchList(vault)),
      ],
    );
  }

  Widget _browseList(VaultModel vault) {
    final children = _childrenOf(vault.tree);
    return RefreshIndicator(
      onRefresh: vault.refresh,
      child: ListView.builder(
        // Always scrollable so pull-to-refresh works on short levels too.
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: children.length,
        itemBuilder: (ctx, i) {
          final n = children[i];
          if (n.kind == 'dir') {
            return ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: Text(n.name),
              onTap: () => _drill(n.name),
            );
          }
          return ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(n.name),
            onTap: () => Navigator.of(ctx).pushNamed('/note', arguments: n.path),
          );
        },
      ),
    );
  }

  Widget _searchList(VaultModel vault) {
    if (vault.searching && vault.matches.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (vault.searchFailed) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('搜索失败'),
            TextButton(
              onPressed: () => vault.search(vault.query),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }
    if (vault.matches.isEmpty) return const Center(child: Text('无匹配结果'));
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: vault.matches.length,
      itemBuilder: (ctx, i) {
        final m = vault.matches[i];
        return ListTile(
          title: Text(m.text),
          subtitle: Text(m.path),
          onTap: () => Navigator.of(ctx).pushNamed('/note', arguments: m.path),
        );
      },
    );
  }
}
```

（搜索分支与空态虽属 Task 5 验收，此处一并落最小实现保证页面可用；Task 5 只补测试。若要严格 TDD，可在本任务只写 `_browseList` 骨架、搜索框返回 SizedBox——但页面一体成型更符合现状，**裁定：实现一次到位，测试分两任务钉**。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/pages/vault_page_test.dart`
Expected: PASS 6/6。

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git add lib/pages/vault_page.dart test/pages/vault_page_test.dart && git commit -F - <<'EOF'
feat(mobile): add the vault browse page

- entry refreshes the tree while the old one stays visible
- drill-down keeps an internal path stack, back pops one level first
- dirs sort before files, rows build lazily for large levels
- files push /note with their vault-relative path
EOF
```

---

### Task 5: VaultPage 搜索与空态（测试补钉）

Task 4 已带实现，本任务补齐搜索/空态的 RED→GREEN 证明。若 Step 1 测试直接通过，按 TDD 纪律视为「实现先于测试」——回退 Task 4 的实现 commit 不现实；**裁定：接受实现先行，本任务测试必须先以「错误断言」验证其能失败（如先断言文案不存在跑一次 RED），再改正确断言跑 GREEN**，保证测试本身被验过。

**Files:**
- Test: `apps/mobile/test/pages/vault_page_test.dart`（追加）

**Interfaces:**
- Consumes: Task 4 harness/VaultPage；Task 3 `search`。
- Produces: 无新接口。

- [ ] **Step 1: Write the failing tests**（追加进 `main`；先按 §"验证 RED" 步骤跑失败）

```dart
  testWidgets('typing swaps in search results and a tap opens the note', (tester) async {
    final client = ApiClient(
      client: MockClient((req) async {
        if (req.url.path == '/api/vault/tree') return treeResponse();
        if (req.url.path == '/api/vault/search') {
          return http.Response(
            jsonEncode({'matches': [
              {'path': '项目管理/索引.md', 'line': 3, 'text': '京能 部署架构'},
            ]}),
            200,
          );
        }
        return http.Response(jsonEncode({}), 404);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    final pushed = <String?>[];
    await tester.pumpWidget(harness(
      client,
      onGenerateRoute: (s) {
        pushed.add(s.name);
        return MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('NOTE')));
      },
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '部署');
    await tester.pump(const Duration(milliseconds: 400)); // past the debounce
    await tester.pumpAndSettle();
    expect(find.text('京能 部署架构'), findsOneWidget);
    expect(find.text('项目管理/索引.md'), findsOneWidget);
    expect(find.text('f0.md'), findsNothing); // browse list replaced

    await tester.tap(find.text('京能 部署架构'));
    await tester.pumpAndSettle();
    expect(pushed.last, '/note');
  });

  testWidgets('clearing the query restores the browse list', (tester) async {
    final client = ApiClient(
      client: MockClient((req) async {
        if (req.url.path == '/api/vault/tree') return treeResponse();
        return http.Response(jsonEncode({'matches': []}), 200);
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'x');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('无匹配结果'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    expect(find.text('f0.md'), findsOneWidget); // browse list is back
  });

  testWidgets('shows the not-configured empty state on 503', (tester) async {
    final client = ApiClient(
      client: MockClient((req) async =>
          http.Response(jsonEncode({'error': 'vault_not_configured'}), 503)),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();

    expect(find.text('知识库未配置'), findsOneWidget);
    expect(find.byType(TextField), findsNothing); // no dead search box
  });

  testWidgets('shows a retryable error state when the tree fetch fails', (tester) async {
    var down = true;
    final client = ApiClient(
      client: MockClient((req) async {
        if (down) throw Exception('offline');
        return treeResponse();
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();
    expect(find.text('加载失败'), findsOneWidget);

    down = false;
    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();
    expect(find.text('f0.md'), findsOneWidget);
  });
```

- [ ] **Step 2: 验证 RED（纪律步骤）**

Run: `cd apps/mobile && flutter test test/pages/vault_page_test.dart`
Expected: 若 Task 4 实现完整，此处 PASS——即为「实现先行」证据。执行 RED 验证：临时把任一断言反转（如 `findsOneWidget` → `findsNothing`）跑一次确认测试有牙齿，再还原。

- [ ] **Step 3: 确认 GREEN**

Run: `cd apps/mobile && flutter test test/pages/vault_page_test.dart`
Expected: PASS 10/10。

- [ ] **Step 4: Commit**

```bash
cd apps/mobile && git add test/pages/vault_page_test.dart && git commit -F - <<'EOF'
test(mobile): pin vault search swap and empty states

- debounced query replaces the browse list; results open /note
- clearing the query restores the browse list
- 503 renders the not-configured empty state without a search box
- a failed tree fetch offers a working retry
EOF
```

---

### Task 6: NotePage

**Files:**
- Create: `apps/mobile/lib/pages/note_page.dart`
- Test: `apps/mobile/test/pages/note_page_test.dart`

**Interfaces:**
- Consumes: Task 3 `VaultModel.readNote`；既有 `MarkdownBody`（`lib/widgets/markdown_body.dart`）。
- Produces: `class NotePage extends StatefulWidget { const NotePage({super.key, required this.path}); final String path; }`——Task 7 路由以 `NotePage(path: args as String)` 组装。

- [ ] **Step 1: Write the failing test**

```dart
// apps/mobile/test/pages/note_page_test.dart
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/note_page.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

Widget harness(ApiClient client) => MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: client),
        ChangeNotifierProvider<VaultModel>.value(value: VaultModel(client: client)),
      ],
      child: const MaterialApp(home: NotePage(path: '项目管理/索引.md')),
    );

void main() {
  testWidgets('renders the note markdown under the file-name title', (tester) async {
    final client = ApiClient(
      client: MockClient((req) async {
        expect(req.url.queryParameters['path'], '项目管理/索引.md');
        return http.Response(
          jsonEncode({'path': '项目管理/索引.md', 'content': '# 部署架构\n\n正文段落'}),
          200,
        );
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();

    expect(find.text('索引.md'), findsOneWidget); // appbar title from the path
    expect(find.text('部署架构'), findsOneWidget); // heading rendered, '#' consumed
    expect(find.text('正文段落'), findsOneWidget);
  });

  testWidgets('a failed fetch offers a working retry', (tester) async {
    var down = true;
    final client = ApiClient(
      client: MockClient((req) async {
        if (down) throw Exception('offline');
        return http.Response(
          jsonEncode({'path': 'x', 'content': '内容'}),
          200,
        );
      }),
      base: () => Uri.parse('https://x.example'),
      token: () => 'tok',
    );
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();
    expect(find.text('加载失败'), findsOneWidget);

    down = false;
    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();
    expect(find.text('内容'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/pages/note_page_test.dart`
Expected: FAIL — `note_page.dart` 不存在。

- [ ] **Step 3: Write minimal implementation**

```dart
// apps/mobile/lib/pages/note_page.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/vault/vault_model.dart';
import 'package:ccferry_mobile/widgets/markdown_body.dart';

class NotePage extends StatefulWidget {
  const NotePage({super.key, required this.path});

  final String path;

  @override
  State<NotePage> createState() => _NotePageState();
}

class _NotePageState extends State<NotePage> {
  String? _content;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _content = null;
      _error = null;
    });
    try {
      final content = await context.read<VaultModel>().readNote(widget.path);
      if (mounted) setState(() => _content = content);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.path.split('/').last)),
      body: _content != null
          ? SingleChildScrollView(
              padding: const EdgeInsets.all(12),
              child: MarkdownBody(text: _content!),
            )
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('加载失败'),
                      TextButton(onPressed: _load, child: const Text('重试')),
                    ],
                  ),
                )
              : const Center(child: CircularProgressIndicator()),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/pages/note_page_test.dart`
Expected: PASS 2/2。

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git add lib/pages/note_page.dart test/pages/note_page_test.dart && git commit -F - <<'EOF'
feat(mobile): add the note reading page

- loads content via VaultModel.readNote and renders MarkdownBody
- title comes from the path's file name
- failed fetches offer a working retry
EOF
```

---

### Task 7: 接线（路由 + 入口 + production-shape）

**Files:**
- Modify: `apps/mobile/lib/main.dart`
- Modify: `apps/mobile/lib/pages/sessions_page.dart`（AppBar `actions`，连接徽标与设置按钮之间）
- Test: `apps/mobile/test/pages/sessions_page_test.dart`（harness 加可选 `VaultModel? vault` + 两个用例）

**Interfaces:**
- Consumes: Task 3/4/6 全部产物。
- Produces: 路由 `/vault`（builder: ApiClient+VaultModel `.value` 直供 → `const VaultPage()`）；路由 `/note`（`settings.arguments as String` → `NotePage(path: …)`，同样直供）；SessionsPage AppBar 图标 `Icons.menu_book_outlined`（tooltip '知识库'）。

- [ ] **Step 1: Write the failing tests**（`sessions_page_test.dart`）

harness 增加可选参数（默认 `VaultModel(client: client)`，不影响既有用例）：

```dart
Widget harness({required ApprovalsModel approvals, required SessionsModel model, ApiClient? client, UpdateModel? update, VaultModel? vault}) =>
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: client!),
        ChangeNotifierProvider<AuthModel>.value(value: AuthModel(store: MemoryStore())),
        ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
        ChangeNotifierProvider<SessionsModel>.value(value: model),
        ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
        ChangeNotifierProvider<UpdateModel>.value(value: update ?? updateWithMeta(null)),
        ChangeNotifierProvider<VaultModel>.value(value: vault ?? VaultModel(client: client!)),
      ],
      child: const MaterialApp(home: SessionsPage()),
    );
```

（需补 import：`vault_model.dart`。）

追加用例：

```dart
  testWidgets('book icon pushes /vault', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final pushed = <String?>[];

    await tester.pumpWidget(harness(
      approvals: approvals,
      model: model,
      client: client,
      // harness 的 MaterialApp 不带 onGenerateRoute；本用例需要捕获路由。
      // 落地方式：给 harness 加可选 `void Function(String?)? onRoute`，
      // 在 child MaterialApp 的 onGenerateRoute 里回调后返回 null。
      onRoute: (name) => pushed.add(name),
    ));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.menu_book_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.menu_book_outlined));
    await tester.pumpAndSettle();
    expect(pushed.last, '/vault');
  });

  testWidgets('vault route resolves with providers below the navigator (production shape)',
      (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final vault = VaultModel(client: ApiClient(
      client: MockClient((req) async {
        if (req.url.path == '/api/vault/tree') {
          return http.Response(
            utf8.encode(jsonEncode({'root': '/v', 'tree': []})),
            200,
          );
        }
        return http.Response(jsonEncode({}), 404);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    ));

    // Mirror main.dart: providers sit inside `home:`, the pushed route
    // rebuilds them via .value on the root navigator.
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          Provider<ApiClient>.value(value: client),
          ChangeNotifierProvider<AuthModel>.value(value: AuthModel(store: MemoryStore())),
          ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
          ChangeNotifierProvider<SessionsModel>.value(value: model),
          ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
          ChangeNotifierProvider<UpdateModel>.value(value: updateWithMeta(null)),
          ChangeNotifierProvider<VaultModel>.value(value: vault),
        ],
        child: MaterialApp(
          home: const SessionsPage(),
          onGenerateRoute: (s) => s.name == '/vault'
              ? MaterialPageRoute<void>(
                  builder: (_) => MultiProvider(
                    providers: [
                      Provider<ApiClient>.value(value: client),
                      ChangeNotifierProvider<VaultModel>.value(value: vault),
                    ],
                    child: const VaultPage(),
                  ),
                )
              : null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.menu_book_outlined));
    await tester.pumpAndSettle();
    expect(find.text('知识库'), findsOneWidget); // vault page reachable, provider resolved
  });
```

（harness 签名改动与 `onRoute` 回调属测试支架；如改动 harness 影响既有 12 用例，保持默认参数向后兼容即可。`updateWithMeta`/`routedClient` 为该文件既有支架。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && flutter test test/pages/sessions_page_test.dart`
Expected: FAIL — 无 `menu_book` 图标（`byIcon` 找不到）。

- [ ] **Step 3: Write minimal implementation**

`main.dart`：

```dart
// _CcferryAppState 增加字段（_push 之后）：
VaultModel? _vault;

// _ensureModels() 末尾追加：
_vault = VaultModel(client: _client!);

// import 增加：
import 'package:ccferry_mobile/pages/note_page.dart';
import 'package:ccferry_mobile/pages/vault_page.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

// onGenerateRoute 中 /settings 分支后追加：
        if (settings.name == '/vault') {
          // Root navigator sits above the home provider scope — provide
          // directly (same shape as /settings).
          return MaterialPageRoute<void>(
            settings: settings,
            builder: (ctx) => MultiProvider(
              providers: [
                Provider<ApiClient>.value(value: _client!),
                ChangeNotifierProvider<VaultModel>.value(value: _vault!),
              ],
              child: const VaultPage(),
            ),
          );
        }
        if (settings.name == '/note') {
          final path = settings.arguments as String;
          return MaterialPageRoute<void>(
            settings: settings,
            builder: (ctx) => MultiProvider(
              providers: [
                Provider<ApiClient>.value(value: _client!),
                ChangeNotifierProvider<VaultModel>.value(value: _vault!),
              ],
              child: NotePage(path: path),
            ),
          );
        }

// _sessionsHome() providers 追加：
        ChangeNotifierProvider<VaultModel>.value(value: _vault!),
```

`sessions_page.dart`（AppBar `actions`，连接徽标与设置之间插入）：

```dart
          IconButton(
            icon: const Icon(Icons.menu_book_outlined),
            tooltip: '知识库',
            onPressed: () => Navigator.of(context).pushNamed('/vault'),
          ),
```

（import 增加 `vault_model.dart`；SessionsPage 本体不读 VaultModel，仅路由跳转。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && flutter test test/pages/sessions_page_test.dart`
Expected: PASS 14/14（12 既有 + 2 新）。

- [ ] **Step 5: 全量收尾**

Run: `cd apps/mobile && flutter test && flutter analyze`
Expected: 全量 PASS（117 既有 + 本计划新增 ≈ 23 → ≈140），analyze 零 issue。

- [ ] **Step 6: Commit**

```bash
cd apps/mobile && git add lib/main.dart lib/pages/sessions_page.dart test/pages/sessions_page_test.dart && git commit -F - <<'EOF'
feat(mobile): wire the vault entry and routes

- app-lifetime VaultModel built beside the other models
- /vault and /note routes provide ApiClient and VaultModel directly
  on the root navigator
- knowledge-base icon on the sessions app bar between the badge and settings
- production-shape test pins provider resolution for the pushed route
EOF
```

---

## 计划自审记录

1. **Spec 覆盖**：spec §4 文件职责表 ↔ Task 1-7 一一对应；§6 测试口径逐条落位（模型 5 条→Task 3，页面浏览/下钻/刷新→Task 4，搜索/未配置/重试→Task 5，NotePage→Task 6，入口+production-shape→Task 7）。spec §3 实现要点（getJsonQuery）→Task 2。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤带完整代码；两处「裁定」为显式裁决非占位（Task 4 实现一次到位、Task 5 RED 验证方式、Task 7 harness 支架写法）。
3. **类型一致性**：`VaultNode.tryFromJson`/`VaultSearchMatch.fromJson`/`getJsonQuery`/`VaultPhase`/`refresh`/`search`/`readNote`/`NotePage(path:)` 各任务间逐字一致；路由名 `/vault`、`/note` 与参数（path 字符串）一致。
4. **Review Focus**：5 条均已钉进所属任务（见各条标注）。

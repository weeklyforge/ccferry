import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/sessions_page.dart';
import 'package:ccferry_mobile/pages/settings_page.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/state/auth_model.dart';
import 'package:ccferry_mobile/state/connection_model.dart';
import 'package:ccferry_mobile/state/secure_store.dart';
import 'package:ccferry_mobile/state/sessions_model.dart';
import 'package:ccferry_mobile/update/update_model.dart';
import 'package:ccferry_mobile/update/update_release.dart';
import 'package:ccferry_mobile/update/update_service.dart';

class MemoryStore implements SecureStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

// Routed fake: JSON for the list/approval GETs, a never-completing body for
// the events stream (fake_async flags pending reconnect timers otherwise).
// events: 'open' (default) resolves a hanging 200 stream — the follower sees
// a healthy connection; 'hang' never resolves the response — the follower
// stays in its initial connecting state.
ApiClient routedClient({required void Function(int) onLoad, String events = 'open'}) =>
    ApiClient(
      client: MockClient.streaming((req, _) async {
        if (req.url.path == '/api/events/stream') {
          if (events == 'hang') return Completer<http.StreamedResponse>().future;
          return http.StreamedResponse(StreamController<List<int>>().stream, 200);
        }
        if (req.url.path == '/api/sessions') {
          onLoad(1);
          return http.StreamedResponse(
            Stream.value(utf8.encode(jsonEncode([
              {
                'sessionId': 'a',
                'projectPath': r'D:\work\pkg',
                'file': 'a.jsonl',
                'sizeBytes': 1,
                'lastModifiedMs': DateTime.now().millisecondsSinceEpoch,
                'firstUserText': 'fix login',
              },
            ]))),
            200,
          );
        }
        return http.StreamedResponse(
          Stream.value(utf8.encode(jsonEncode({'approvals': []}))),
          200,
        );
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );

// A model that reaches `available` through the real check() path (SessionsPage's
// initState drives it): fetchMeta serves the given release, or '' -> null.
UpdateModel updateWithMeta(UpdateRelease? meta) => UpdateModel(
      service: UpdateService(
        fetchMeta: () async => meta == null
            ? ''
            : '{"version":"${meta.version}","versionCode":${meta.versionCode},'
                '"sha256":"${meta.sha256}","apk":"${meta.apk}","notes":"${meta.notes}"}',
        openApk: (_) => throw UnimplementedError(),
        cacheDirPath: () => throw UnimplementedError(),
      ),
      localVersion: () async => (1, '1.0.0'),
    );

const newerRelease = UpdateRelease(
    version: '9.9.9', versionCode: 99, sha256: 'a', apk: 'ccferry.apk', notes: '- 修复大问题');

Widget harness({required ApprovalsModel approvals, required SessionsModel model, ApiClient? client, UpdateModel? update}) =>
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: client!),
        ChangeNotifierProvider<AuthModel>.value(value: AuthModel(store: MemoryStore())),
        ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
        ChangeNotifierProvider<SessionsModel>.value(value: model),
        ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
        ChangeNotifierProvider<UpdateModel>.value(value: update ?? updateWithMeta(null)),
      ],
      child: const MaterialApp(home: SessionsPage()),
    );

void main() {
  testWidgets('renders grouped sessions with status and relative time', (tester) async {
    var loads = 0;
    final client = routedClient(onLoad: (n) => loads += n);
    final approvals = ApprovalsModel(client: client);
    approvals.ingest(ToolApprovalRequest.fromJson(approvalFor('a')));
    final model = SessionsModel(client: client, approvals: approvals);
    await model.refresh();

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client));
    await tester.pumpAndSettle();

    // PWA Collapse semantics: every project group starts collapsed — the
    // header row shows, the sessions stay hidden until the header is tapped.
    expect(find.text('pkg'), findsOneWidget);
    expect(find.text('fix login'), findsNothing);
    await tester.tap(find.text('pkg'));
    await tester.pumpAndSettle();
    expect(find.text('fix login'), findsOneWidget);
    expect(find.text('等你批准'), findsOneWidget);
    expect(find.text('刚刚'), findsOneWidget);
  });

  testWidgets('polls refresh every 10 seconds while visible', (tester) async {
    var loads = 0;
    final client = routedClient(onLoad: (n) => loads += n);
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client));
    await tester.pumpAndSettle();
    final afterFirst = loads;
    await tester.pump(const Duration(seconds: 10));
    expect(loads, greaterThan(afterFirst));
  });

  testWidgets('shows the connected badge once the events stream opens', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client));
    await tester.pumpAndSettle();

    expect(find.text('已连接'), findsOneWidget);
  });

  testWidgets('stays on the connecting badge while the events stream hangs', (tester) async {
    final client = routedClient(onLoad: (_) {}, events: 'hang');
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('连接中'), findsOneWidget);
    expect(find.text('已连接'), findsNothing);
  });

  testWidgets('gear opens settings prefilled; saving reconfigures auth', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final store = MemoryStore();
    final auth = AuthModel(store: store);
    await auth.save(daemonBase: 'https://old.example', accessToken: 'old-token');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          Provider<ApiClient>.value(value: client),
          ChangeNotifierProvider<AuthModel>.value(value: auth),
          ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
          ChangeNotifierProvider<SessionsModel>.value(value: model),
          ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
          ChangeNotifierProvider<UpdateModel>.value(value: updateWithMeta(null)),
        ],
        child: MaterialApp(
          home: const SessionsPage(),
          // The gear pushes a material route with the settings page.
          onGenerateRoute: (s) => s.name == '/settings'
              ? MaterialPageRoute<void>(builder: (_) => const SettingsPage())
              : null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    expect(find.text('设置'), findsOneWidget);

    final baseField = tester.widget<TextField>(find.byKey(const Key('field-base')));
    final tokenField = tester.widget<TextField>(find.byKey(const Key('field-token')));
    expect(baseField.controller!.text, 'https://old.example');
    expect(tokenField.controller!.text, 'old-token');

    await tester.enterText(find.byKey(const Key('field-base')), 'https://new.example');
    await tester.enterText(find.byKey(const Key('field-token')), 'new-token');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(auth.base, 'https://new.example');
    expect(auth.token, 'new-token');
    expect(await store.read('daemonBase'), 'https://new.example');
  });

  testWidgets('prompts with release notes when a newer version exists', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle(); // the page auto-check resolves -> available -> dialog

    expect(find.textContaining('发现新版本 9.9.9'), findsOneWidget);
    expect(find.textContaining('- 修复大问题'), findsOneWidget);
  });

  testWidgets('prompts even when providers sit below the navigator (production shape)', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);

    // Production main.dart provides the models inside `home:`, below the root
    // navigator that showDialog builds on. The dialog must still find them.
    await tester.pumpWidget(
      MaterialApp(
        home: MultiProvider(
          providers: [
            Provider<ApiClient>.value(value: client),
            ChangeNotifierProvider<AuthModel>.value(value: AuthModel(store: MemoryStore())),
            ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
            ChangeNotifierProvider<SessionsModel>.value(value: model),
            ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
            ChangeNotifierProvider<UpdateModel>.value(value: update),
          ],
          child: const SessionsPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('发现新版本 9.9.9'), findsOneWidget);
  });

  testWidgets('no dialog when the check fails silently', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(null); // fetchMeta returns '' -> failed (silent)

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    expect(find.textContaining('发现新版本'), findsNothing);
  });

  testWidgets('later button dismisses for this boot', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    await tester.tap(find.text('以后再说'));
    await tester.pumpAndSettle();

    expect(find.textContaining('发现新版本'), findsNothing);
    expect(update.dismissed, isTrue);
  });

  testWidgets('download button starts the download and shows progress', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    // A real check to available, then a download that never completes: the
    // dialog must sit in the progress state.
    final hanging = UpdateService(
      fetchMeta: () async =>
          '{"version":"9.9.9","versionCode":99,"sha256":"a","apk":"ccferry.apk","notes":"n"}',
      cacheDirPath: () async => '/unused',
      openApk: (_) => Completer<({Stream<List<int>> stream, int? contentLength})>().future,
    );
    final update = UpdateModel(service: hanging, localVersion: () async => (1, '1.0.0'));

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    await tester.tap(find.text('下载更新'));
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('以后再说'), findsNothing); // cannot back out mid-download
  });

  testWidgets('the ready state auto-fires the installer exactly once', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);
    var installCalls = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ccferry/install'), (call) async {
      installCalls++;
      return 'started';
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ccferry/install'), null));

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle(); // dialog is open on available

    // Jump straight to ready via the Task 3 test seam: the dialog auto-fires
    // the installer once and stays open on the installing affordance (the
    // system installer takes over on device).
    update.debugCompleteDownload('/cache/ccferry-update.apk');
    await tester.pumpAndSettle();

    expect(installCalls, 1);
    expect(find.text('立即安装'), findsOneWidget);
  });
}

// Minimal approval targeting session 'a' for the awaiting-status assertion.
Map<String, dynamic> approvalFor(String sessionId) => {
      'approvalId': 'ap-$sessionId',
      'sessionId': sessionId,
      'toolName': 'Bash',
      'input': {},
      'createdAtMs': DateTime.now().millisecondsSinceEpoch,
      'timeoutMs': 600000,
    };

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/vault_page.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

// Response(String) latin1-encodes, and Response.bytes without a charset
// header latin1-DEcodes — Chinese bodies need utf8 bytes + charset header
// (what the daemon actually sends).
http.Response jsonResponse(Object body, [int status = 200]) => http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

http.Response treeResponse({int files = 1}) => jsonResponse({
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
    });

class CountingClient {
  int treeHits = 0;
  late final ApiClient api = ApiClient(
    client: MockClient((req) async {
      if (req.url.path == '/api/vault/tree') {
        treeHits++;
        return treeResponse();
      }
      return jsonResponse({}, 404);
    }),
    base: () => Uri.parse('https://x.example'),
    token: () => 'tok',
  );
}

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
    await tester.pumpWidget(harness(CountingClient().api));
    await tester.pumpAndSettle();

    final dirY = tester.getTopLeft(find.text('项目管理')).dy;
    final fileY = tester.getTopLeft(find.text('f0.md')).dy;
    expect(dirY, lessThan(fileY));
    expect(find.text('知识库'), findsOneWidget); // root title
  });

  testWidgets('drills into a dir and the back button pops one level', (tester) async {
    await tester.pumpWidget(harness(CountingClient().api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('项目管理'));
    await tester.pumpAndSettle();
    expect(find.text('项目管理'), findsOneWidget); // appbar title only — rows are now children
    expect(find.text('索引.md'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('f0.md'), findsOneWidget); // back at root
    expect(find.byType(BackButton), findsNothing);
  });

  testWidgets('system back pops one level before leaving the page', (tester) async {
    await tester.pumpWidget(harness(CountingClient().api));
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
      CountingClient().api,
      onGenerateRoute: (s) {
        pushed.add(s.name);
        return MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('NOTE')));
      },
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('项目管理')); // drill in first — the note sits inside
    await tester.pumpAndSettle();
    await tester.tap(find.text('索引.md'));
    await tester.pumpAndSettle();
    expect(pushed.last, '/note');
    expect(find.text('NOTE'), findsOneWidget);
  });

  testWidgets('refreshes the tree on entry and on pull-to-refresh', (tester) async {
    final counting = CountingClient();
    await tester.pumpWidget(harness(counting.api));
    await tester.pumpAndSettle();
    final hits1 = counting.treeHits;
    expect(hits1, 1); // entry refresh

    await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
    await tester.pumpAndSettle();
    expect(counting.treeHits, greaterThan(hits1)); // pull-to-refresh refetch
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

    // Make the viewport tall enough to cover the whole level instead of
    // fighting dragUntilVisible over ~28k logical px of list.
    tester.view.physicalSize = const Size(800, 60000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pump();
    expect(find.text('f499.md'), findsOneWidget);

    // AlwaysScrollableScrollPhysics: overscroll works even when the content
    // fits, so pull-to-refresh still triggers on a long level.
    await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
    await tester.pumpAndSettle(); // completes without throwing
  });
}

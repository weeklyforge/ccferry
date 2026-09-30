import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/note_page.dart';
import 'package:ccferry_mobile/vault/vault_model.dart';

// Response(String) latin1-encodes, and Response.bytes without a charset
// header latin1-DEcodes — Chinese bodies need utf8 bytes + charset header.
http.Response jsonResponse(Object body, [int status = 200]) => http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

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
        return jsonResponse({'path': '项目管理/索引.md', 'content': '# 部署架构\n\n正文段落'});
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
        return jsonResponse({'path': 'x', 'content': '内容'});
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

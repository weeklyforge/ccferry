import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/sessions_page.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/state/sessions_model.dart';

ApiFunction clientOf = (_) async => http.Response(jsonEncode([]), 200);
typedef ApiFunction = Future<http.Response> Function(http.Request r);

ApiClient clientWith(ApiFunction fn) =>
    ApiClient(client: MockClient((r) async => fn(r)), base: () => Uri.parse('https://x'), token: () => 't');

Future<SessionsModel> modelWith({
  required ApprovalsModel approvals,
  required void Function(int) onLoad,
}) async {
  final model = SessionsModel(
    client: clientWith((r) async {
      onLoad(1);
      if (r.url.path == '/api/sessions') {
        return http.Response(
          jsonEncode([
            {
              'sessionId': 'a',
              'projectPath': r'D:\work\pkg',
              'file': 'a.jsonl',
              'sizeBytes': 1,
              'lastModifiedMs': DateTime.now().millisecondsSinceEpoch,
              'firstUserText': 'fix login',
            },
          ]),
          200,
        );
      }
      return http.Response(jsonEncode({'approvals': []}), 200);
    }),
    approvals: approvals,
  );
  return model;
}

void main() {
  testWidgets('renders grouped sessions with status and relative time', (tester) async {
    final approvals = ApprovalsModel(
      client: clientWith((_) async => http.Response('', 204)),
    );
    approvals.ingest(ToolApprovalRequest.fromJson(approvalFor('a')));
    final model = await modelWith(approvals: approvals, onLoad: (_) {});
    await model.refresh();

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
          ChangeNotifierProvider<SessionsModel>.value(value: model),
        ],
        child: const MaterialApp(home: SessionsPage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('pkg'), findsOneWidget);
    expect(find.text('fix login'), findsOneWidget);
    expect(find.text('等你批准'), findsOneWidget);
    expect(find.text('刚刚'), findsOneWidget);
  });

  testWidgets('polls refresh every 10 seconds while visible', (tester) async {
    var loads = 0;
    final approvals = ApprovalsModel(
      client: clientWith((_) async => http.Response('', 204)),
    );
    final model = await modelWith(approvals: approvals, onLoad: (n) => loads += n);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
          ChangeNotifierProvider<SessionsModel>.value(value: model),
        ],
        child: const MaterialApp(home: SessionsPage()),
      ),
    );
    await tester.pumpAndSettle();
    final afterFirst = loads;
    await tester.pump(const Duration(seconds: 10));
    expect(loads, greaterThan(afterFirst));
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

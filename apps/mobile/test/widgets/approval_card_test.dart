import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/widgets/approval_card.dart';

ToolApprovalRequest request(String id, {String? sessionId}) => ToolApprovalRequest(
      approvalId: id,
      sessionId: sessionId,
      toolName: 'Edit',
      input: {'file_path': '/work/a.md'},
      createdAtMs: DateTime.now().millisecondsSinceEpoch,
      timeoutMs: 600000,
    );

ApiClient okClient(List<String> bodies) => ApiClient(
      client: MockClient((r) async {
        bodies.add((r).body);
        return http.Response('', 204);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );

void main() {  testWidgets('renders tool name and decides on button taps', (tester) async {
    final bodies = <String>[];
    final model = ApprovalsModel(client: okClient(bodies));
    model.ingest(request('a1', sessionId: 's1'));

    await tester.pumpWidget(MultiProvider(
      providers: [ChangeNotifierProvider<ApprovalsModel>.value(value: model)],
      child: MaterialApp(
        home: Scaffold(
          body: ListView(
            children: [ApprovalCard(request: model.pending.single)],
          ),
        ),
      ),
    ));

    expect(find.text('Edit'), findsOneWidget);
    expect(find.textContaining('a.md'), findsOneWidget);

    await tester.tap(find.text('批准'));
    await tester.pumpAndSettle();
    expect(bodies.single, jsonEncode({'decision': 'allow'}));
    expect(model.pending, isEmpty); // card leaves only after the POST landed
  });

  testWidgets('deny posts deny', (tester) async {
    final bodies = <String>[];
    final model = ApprovalsModel(client: okClient(bodies));
    model.ingest(request('a2', sessionId: 's1'));

    await tester.pumpWidget(MultiProvider(
      providers: [ChangeNotifierProvider<ApprovalsModel>.value(value: model)],
      child: MaterialApp(
        home: Scaffold(
          body: ListView(children: [ApprovalCard(request: model.pending.single)]),
        ),
      ),
    ));

    await tester.tap(find.text('拒绝'));
    await tester.pumpAndSettle();
    expect(bodies.single, jsonEncode({'decision': 'deny'}));
  });

  test('handleFrame ingests request frames and drops settled ones', () {
    final model = ApprovalsModel(client: okClient([]));
    model.handleFrame({
      'approvalId': 'a3',
      'sessionId': 's1',
      'toolName': 'Bash',
      'input': {},
      'createdAtMs': 0,
      'timeoutMs': 600000,
    });
    expect(model.pending.single.approvalId, 'a3');

    model.handleFrame({'type': 'settled', 'approvalId': 'a3', 'decision': 'timeout'});
    expect(model.pending, isEmpty);
  });

  test('sweepExpired prunes timed-out cards', () {
    final model = ApprovalsModel(client: okClient([]));
    model.ingest(request('a4')); // createdAt now, timeout 10 min — alive
    model.sweepExpired(DateTime.now().add(const Duration(minutes: 1)));
    expect(model.pending.length, 1);
    model.sweepExpired(DateTime.now().add(const Duration(minutes: 11)));
    expect(model.pending, isEmpty);
  });
}

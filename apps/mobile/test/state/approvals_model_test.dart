import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/protocol/events.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';

ToolApprovalRequest req(String id, {int createdAtMs = 0, int timeoutMs = 60000}) =>
    ToolApprovalRequest(
      approvalId: id,
      sessionId: 's1',
      toolName: 'Bash',
      input: {},
      createdAtMs: createdAtMs,
      timeoutMs: timeoutMs,
    );

ApiClient clientResponding(http.Response Function(http.Request r) fn) =>
    ApiClient(client: MockClient((r) async => fn(r)), base: () => Uri.parse('https://x'), token: () => 't');

void main() {
  test('ingest dedupes by approvalId', () {
    final m = ApprovalsModel(client: clientResponding((r) => http.Response('', 204)));
    m.ingest(req('a1'));
    m.ingest(req('a1'));
    expect(m.pending.length, 1);
  });

  test('decide removes the card only after the POST succeeds', () async {
    var calls = 0;
    final m = ApprovalsModel(
      client: clientResponding((r) {
        calls++;
        return calls == 1 ? http.Response('boom', 500) : http.Response('', 204);
      }),
    );
    m.ingest(req('a1'));
    await expectLater(m.decide('a1', 'allow'), throwsA(isA<ApiError>()));
    expect(m.pending.length, 1); // still visible — the decision did not land
    await m.decide('a1', 'allow');
    expect(m.pending, isEmpty);
  });

  test('decide posts the decision body', () async {
    final bodies = <String>[];
    final m = ApprovalsModel(
      client: clientResponding((r) {
        bodies.add(r.body);
        return http.Response('', 204);
      }),
    );
    m.ingest(req('a1'));
    await m.decide('a1', 'deny');
    expect(bodies.single, jsonEncode({'decision': 'deny'}));
  });

  test('sweepExpired drops timed-out cards', () {
    final m = ApprovalsModel(client: clientResponding((r) => http.Response('', 204)));
    m.ingest(req('old', createdAtMs: 0, timeoutMs: 60000));
    m.ingest(req('fresh', createdAtMs: 150000, timeoutMs: 60000)); // 50s < 60s — alive
    m.sweepExpired(DateTime.fromMillisecondsSinceEpoch(200000));
    expect(m.pending.single.approvalId, 'fresh');
  });
}

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/state/sessions_model.dart';

ApiClient routingClient({required int sessionsStatus, List<Map<String, dynamic>>? approvals}) =>
    ApiClient(
      client: MockClient((r) async {
        final path = r.url.path;
        if (path == '/api/sessions') {
          return http.Response(
            sessionsStatus == 200
                ? jsonEncode([
                    {
                      'sessionId': 'a',
                      'projectPath': r'D:\work\pkg',
                      'file': 'a.jsonl',
                      'sizeBytes': 1,
                      'lastModifiedMs': 1,
                      'firstUserText': 'fix login',
                    },
                    {
                      'sessionId': 'b',
                      'projectPath': r'D:\work\pkg',
                      'file': 'b.jsonl',
                      'sizeBytes': 2,
                      'lastModifiedMs': 2,
                      'firstUserText': 'write docs',
                    },
                    {
                      'sessionId': 'c',
                      'projectPath': '/home/me/app',
                      'file': 'c.jsonl',
                      'sizeBytes': 3,
                      'lastModifiedMs': 3,
                      'firstUserText': '',
                    },
                  ])
                : 'no',
            sessionsStatus,
            headers: {'content-type': 'application/json'},
          );
        }
        if (path == '/api/approvals') {
          return http.Response(jsonEncode({'approvals': approvals ?? []}), 200);
        }
        return http.Response('not found', 404);
      }),
      base: () => Uri.parse('https://x'),
      token: () => 't',
    );

void main() {
  test('refresh loads sessions and ingests approvals', () async {
    final approvals = ApprovalsModel(
      client: ApiClient(
        client: MockClient((r) async => http.Response('', 204)),
        base: () => Uri.parse('https://x'),
        token: () => 't',
      ),
    );
    final m = SessionsModel(
      client: routingClient(sessionsStatus: 200, approvals: [
        {'approvalId': 'x1', 'sessionId': 'a', 'toolName': 'Edit', 'input': {}, 'createdAtMs': 0, 'timeoutMs': 1000},
      ]),
      approvals: approvals,
    );
    await m.refresh();
    expect(m.sessions.length, 3);
    expect(approvals.pending.single.approvalId, 'x1');
    expect(m.unauthorized, isFalse);
  });

  test('401 keeps the old list and flags unauthorized', () async {
    final m = SessionsModel(
      client: routingClient(sessionsStatus: 401),
      approvals: ApprovalsModel(
        client: ApiClient(
          client: MockClient((r) async => http.Response('', 204)),
          base: () => Uri.parse('https://x'),
          token: () => 't',
        ),
      ),
    );
    await m.refresh();
    expect(m.unauthorized, isTrue);
  });

  test('groups by project path preserving first-seen order with short names', () async {
    final m = SessionsModel(
      client: routingClient(sessionsStatus: 200),
      approvals: ApprovalsModel(
        client: ApiClient(
          client: MockClient((r) async => http.Response('', 204)),
          base: () => Uri.parse('https://x'),
          token: () => 't',
        ),
      ),
    );
    await m.refresh();
    expect(m.groups.length, 2);
    expect(m.groups[0].shortName, 'pkg'); // windows path basename
    expect(m.groups[0].list.length, 2);
    expect(m.groups[1].shortName, 'app'); // posix path basename
  });

  test('shortProject handles trailing separators', () {
    expect(shortProject(r'D:\work\pkg\'), 'pkg');
    expect(shortProject('/a/b/'), 'b');
    expect(shortProject(''), '');
  });
}

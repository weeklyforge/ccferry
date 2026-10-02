

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/session_page.dart';
import 'package:ccferry_mobile/session/stream_model.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';

import '../session/stream_model_test.dart' show FakeSource;

// The page reads ApiClient from the tree for its composer and follows the
// approvals stream. The client's GET streams never complete (like live SSE),
// so fake_async sees no pending reconnect timers at test end.
Widget harness(SessionStreamModel model) {
  final client = ApiClient(
    client: MockClient.streaming((req, body) async {
      final controller = StreamController<List<int>>();
      // Body stays open — tearing the widget tree down cancels the streams.
      return http.StreamedResponse(controller.stream, 200);
    }),
    base: () => Uri.parse('https://x'),
    token: () => 't',
  );
  return MultiProvider(
    providers: [
      Provider<ApiClient>.value(value: client),
      ChangeNotifierProvider<ApprovalsModel>.value(value: ApprovalsModel(client: client)),
      ChangeNotifierProvider<SessionStreamModel>.value(value: model),
    ],
    child: const MaterialApp(home: SessionPage(sessionId: 's1')),
  );
}

void main() {
  testWidgets('renders bubbles, tool status, and expandable results', (tester) async {
    final source = FakeSource([
      '{"uuid":"u1","type":"user","message":{"content":"fix the login"}}',
      '{"uuid":"a1","type":"assistant","message":{"content":[{"type":"text","text":"on it"}]}}',
      '{"uuid":"t1","type":"assistant","message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"a.md"},"timestamp":"2026-09-29T10:00:00.000Z"}]}}',
      '{"uuid":"r1","type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"e1","content":"The file has been updated."}]}}',
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('fix the login'), findsOneWidget);
    expect(find.text('on it'), findsOneWidget);
    // Tool row shows the done glyph once its result arrived.
    expect(find.text('✔'), findsOneWidget);
    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('a.md'), findsOneWidget);

    // Expand the tool row → paired result text appears.
    await tester.tap(find.text('Edit'));
    await tester.pump();
    expect(find.text('The file has been updated.'), findsOneWidget);

    model.close();
  });

  testWidgets('tool row shows waiting glyph before its result arrives', (tester) async {
    final source = FakeSource([
      '{"uuid":"t1","type":"assistant","message":{"content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"ls"}}]}}',
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('⏳'), findsOneWidget);
    await tester.tap(find.text('Bash'));
    await tester.pump();
    expect(find.text('⏳ 执行中…'), findsOneWidget);

    model.close();
  });

  testWidgets('offers 加载全部历史 while tailed', (tester) async {
    final source = FakeSource([
      '{"uuid":"u1","type":"user","message":{"content":"hi"}}',
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('加载全部历史'), findsOneWidget);
    await tester.tap(find.text('加载全部历史'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('加载全部历史'), findsNothing); // now following in full mode

    model.close();
  });

  testWidgets('composer clears on send', (tester) async {
    final source = FakeSource([
      '{"uuid":"u1","type":"user","message":{"content":"hi"}}',
    ]);
    final model = SessionStreamModel(connect: source.connectOpen);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));

    await tester.enterText(find.widgetWithText(TextField, '续聊…'), 'hello there');
    await tester.tap(find.text('发送'));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.widgetWithText(TextField, 'hello there'), findsNothing);

    model.close();
  });

  // ListView.builder builds only visible rows, so a finder locating a text
  // IS the visibility oracle: off-viewport rows are not in the tree.
  List<String> historyLines(int n) => [
        for (var i = 0; i < n; i++)
          FakeSource.userLine('u$i', 'msg-$i'),
      ];

  testWidgets('new messages while scrolled up do not yank; pill counts them', (tester) async {
    final source = FakeSource(historyLines(30));
    final model = SessionStreamModel(connect: source.connectLive);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle(); // the pin-to-bottom jump renders one frame later
    expect(find.text('msg-29'), findsOneWidget); // initial load pins to bottom

    await tester.drag(find.byType(ListView), const Offset(0, 300));
    await tester.pumpAndSettle();
    expect(find.text('msg-29'), findsNothing); // scrolled up into history

    source.emit(FakeSource.userLine('n1', 'late-1'));
    source.emit(FakeSource.userLine('n2', 'late-2'));
    source.emit(FakeSource.userLine('n3', 'late-3'));
    await tester.pumpAndSettle();
    expect(find.text('late-3'), findsNothing); // still reading history
    expect(find.text('3 条新消息'), findsOneWidget);

    model.close();
  });

  testWidgets('tapping the pill jumps to bottom and clears the count', (tester) async {
    final source = FakeSource(historyLines(30));
    final model = SessionStreamModel(connect: source.connectLive);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));

    await tester.drag(find.byType(ListView), const Offset(0, 300));
    await tester.pumpAndSettle();

    source.emit(FakeSource.userLine('n1', 'late-1'));
    source.emit(FakeSource.userLine('n2', 'late-2'));
    await tester.pumpAndSettle();
    expect(find.text('2 条新消息'), findsOneWidget);

    await tester.tap(find.text('2 条新消息'));
    await tester.pumpAndSettle();
    expect(find.text('late-2'), findsOneWidget); // caught up
    expect(find.textContaining('条新消息'), findsNothing);

    model.close();
  });

  testWidgets('new message while at the bottom auto-aligns without a pill', (tester) async {
    final source = FakeSource(historyLines(30));
    final model = SessionStreamModel(connect: source.connectLive);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle(); // the pin-to-bottom jump renders one frame later
    expect(find.text('msg-29'), findsOneWidget);

    source.emit(FakeSource.userLine('n1', 'fresh-1'));
    await tester.pumpAndSettle();
    expect(find.text('fresh-1'), findsOneWidget); // followed down
    expect(find.textContaining('条新消息'), findsNothing);

    model.close();
  });

  testWidgets('sending shows the message immediately as a pending bubble', (tester) async {
    final source = FakeSource([FakeSource.userLine('u1', 'hi')]);
    final model = SessionStreamModel(connect: source.connectLive);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, '续聊…'), 'instant-echo');
    await tester.tap(find.text('发送'));
    await tester.pump(); // one frame — no waiting for the daemon echo
    expect(find.text('instant-echo'), findsOneWidget);

    model.close();
  });

  testWidgets('composer has an auto-mode toggle that flips', (tester) async {
    final source = FakeSource([FakeSource.userLine('u1', 'hi')]);
    final model = SessionStreamModel(connect: source.connectLive);

    await tester.pumpWidget(harness(model));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    final bolt = find.byIcon(Icons.bolt);
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.bolt)).isSelected,
        isFalse);
    await tester.tap(bolt);
    await tester.pump();
    expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.bolt)).isSelected,
        isTrue);

    model.close();
  });
}


import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/widgets/markdown_body.dart';

void main() {
  Future<void> pump(WidgetTester tester, String text) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: MarkdownBody(text: text))),
    ));
  }

  testWidgets('renders markdown content including bold', (tester) async {
    await pump(tester, 'hello **world**');
    expect(find.textContaining('hello'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('html payloads render as literal text, never interpreted', (tester) async {
    await pump(tester, 'see <script>alert(1)</script> here');
    expect(find.textContaining('<script>'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('fenced code blocks render without exception', (tester) async {
    await pump(tester, '```typescript\nconst x = 1;\n```');
    expect(find.textContaining('const x = 1;'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}

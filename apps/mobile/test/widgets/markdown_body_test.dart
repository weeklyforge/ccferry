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

  testWidgets('wide tables scroll horizontally instead of being clipped', (tester) async {
    // Long unbroken words keep the intrinsic column width well past the
    // 200px box; the right column would be clipped without a scroller.
    const table = '| aaaaaaaaaaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbbbbbb |\n'
        '| --- | --- |\n'
        '| r1c1-value | r1c2-value |';
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: SizedBox(width: 200, child: MarkdownBody(text: table))),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    final cellCtx = tester.element(find.textContaining('r1c2'));
    expect(Scrollable.of(cellCtx).position.axis, Axis.horizontal);
    // the table really overflows the 200px box
    expect(Scrollable.of(cellCtx).position.maxScrollExtent, greaterThan(0));

    // drag on the scrollable itself — the right-column text sits outside the
    // clipped viewport, so its coordinates would miss in the hit test
    final scrollable =
        find.descendant(of: find.byType(MarkdownBody), matching: find.byType(Scrollable));
    await tester.drag(scrollable.first, const Offset(-250, 0));
    await tester.pumpAndSettle();
    expect(Scrollable.of(cellCtx).position.pixels, greaterThan(0));
  });
}

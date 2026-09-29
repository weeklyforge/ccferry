import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/main.dart' as app;

void main() {
  testWidgets('app shell builds', (tester) async {
    await tester.pumpWidget(const app.CcferryApp());
    expect(find.text('ccferry'), findsOneWidget);
  });
}

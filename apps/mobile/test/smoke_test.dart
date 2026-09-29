import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/main.dart' as app;
import 'package:ccferry_mobile/state/auth_model.dart';
import 'package:ccferry_mobile/state/secure_store.dart';

class MemoryStore implements SecureStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

void main() {
  testWidgets('app shell builds', (tester) async {
    await tester.pumpWidget(app.CcferryApp(auth: AuthModel(store: MemoryStore())));
    await tester.pumpAndSettle();
    // Unauthenticated boot lands on the login page.
    expect(find.text('登录 ccferry'), findsOneWidget);
  });
}

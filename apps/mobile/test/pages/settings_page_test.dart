import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:ccferry_mobile/pages/settings_page.dart';
import 'package:ccferry_mobile/state/auth_model.dart';
import 'package:ccferry_mobile/state/secure_store.dart';

class MemoryStore implements SecureStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

Widget harness(AuthModel auth) => MultiProvider(
      providers: [ChangeNotifierProvider<AuthModel>.value(value: auth)],
      child: MaterialApp(home: Builder(builder: (_) => const SettingsPage())),
    );

void main() {
  testWidgets('renders the current endpoint and token prefilled', (tester) async {
    final auth = AuthModel(store: MemoryStore());
    await auth.save(daemonBase: 'https://old.example', accessToken: 'tok');

    await tester.pumpWidget(harness(auth));
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(find.byKey(const Key('field-base'))).controller!.text,
        'https://old.example');
    expect(tester.widget<TextField>(find.byKey(const Key('field-token'))).controller!.text, 'tok');
  });

  testWidgets('empty fields are rejected with an inline error', (tester) async {
    final auth = AuthModel(store: MemoryStore());
    await tester.pumpWidget(harness(auth));
    await tester.pumpAndSettle();

    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(find.text('请填写隧道地址和访问令牌'), findsOneWidget);
    expect(auth.ready, isFalse);
  });

  testWidgets('saving writes the new values into the model', (tester) async {
    final auth = AuthModel(store: MemoryStore());
    await tester.pumpWidget(harness(auth));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('field-base')), 'https://new.example');
    await tester.enterText(find.byKey(const Key('field-token')), 'new-token');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(auth.base, 'https://new.example');
    expect(auth.token, 'new-token');
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/pages/login_page.dart';
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
  testWidgets('saving stores base token and calls onDone', (tester) async {
    final store = MemoryStore();
    final auth = AuthModel(store: store);
    var done = 0;
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(model: auth, onDone: () => done++)),
    );

    await tester.enterText(find.byKey(const Key('field-base')), 'https://t.example');
    await tester.enterText(find.byKey(const Key('field-token')), 'tok-123');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(store.values['daemonBase'], 'https://t.example');
    expect(store.values['token'], 'tok-123');
    expect(done, 1);
  });

  testWidgets('empty input does not save', (tester) async {
    final store = MemoryStore();
    final auth = AuthModel(store: store);
    var done = 0;
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(model: auth, onDone: () => done++)),
    );

    await tester.tap(find.text('保存'));
    await tester.pump();

    expect(done, 0);
    expect(store.values.containsKey('token'), isFalse);
  });
}

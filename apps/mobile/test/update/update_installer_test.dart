import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_installer.dart';

final testerBinding = TestDefaultBinaryMessengerBinding.instance;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('installApk forwards the path and returns the native verdict', () async {
    Object? sent;
    testerBinding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('ccferry/install'),
      (call) async {
        expect(call.method, 'installApk');
        sent = call.arguments;
        return 'need_permission';
      },
    );
    final installer = UpdateInstaller();
    final verdict = await installer.installApk('/cache/ccferry-update.apk');
    expect(verdict, 'need_permission');
    expect(sent, {'path': '/cache/ccferry-update.apk'});
  });

  test('openPermissionSettings calls the native settings intent', () async {
    var called = false;
    testerBinding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('ccferry/install'),
      (call) async {
        called = call.method == 'openInstallPermissionSettings';
        return null;
      },
    );
    await UpdateInstaller().openPermissionSettings();
    expect(called, isTrue);
  });

  test('a native error propagates to the caller', () async {
    testerBinding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('ccferry/install'),
      (call) async => throw PlatformException(code: 'install_failed', message: 'boom'),
    );
    await expectLater(
      UpdateInstaller().installApk('/x'),
      throwsA(isA<PlatformException>()),
    );
  });
}

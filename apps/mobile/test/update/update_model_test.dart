import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_model.dart';
import 'package:ccferry_mobile/update/update_release.dart';
import 'package:ccferry_mobile/update/update_service.dart';

// A service whose metadata is a fixed release (or empty -> failed check).
// The download side always throws: download tests below build their own
// service when they need real bytes.
UpdateService serviceWith(UpdateRelease? meta) => UpdateService(
      fetchMeta: () async => meta == null
          ? ''
          : '{"version":"${meta.version}","versionCode":${meta.versionCode},'
              '"sha256":"${meta.sha256}","apk":"${meta.apk}","notes":"${meta.notes}"}',
      openApk: () => throw UnimplementedError(),
      cacheDirPath: () => throw UnimplementedError(),
    );

UpdateRelease rel(int code) => UpdateRelease(
    version: '1.0.$code',
    versionCode: code,
    sha256: 'a',
    apk: 'ccferry.apk',
    notes: 'n');

void main() {
  test('a newer remote becomes available with the local label captured', () async {
    final model = UpdateModel(
      service: serviceWith(rel(2)),
      localVersion: () async => (1, '1.0.0'),
    );
    await model.check();
    expect(model.phase, UpdatePhase.available);
    expect(model.release!.versionCode, 2);
    expect(model.localLabel, '1.0.0');
  });

  test('an equal or older remote is upToDate', () async {
    final model = UpdateModel(
      service: serviceWith(rel(1)),
      localVersion: () async => (2, '1.0.1'),
    );
    await model.check();
    expect(model.phase, UpdatePhase.upToDate);
  });

  test('a failed fetch lands on failed and stays silent', () async {
    final model = UpdateModel(
      service: serviceWith(null), // fetchMeta returns '' -> parse null
      localVersion: () async => (1, '1.0.0'),
    );
    await model.check();
    expect(model.phase, UpdatePhase.failed);
  });

  test('download streams progress and reaches ready', () async {
    final dir = await Directory.systemTemp.createTemp('update-model-test');
    addTearDown(() async => await dir.delete(recursive: true));
    final body = List<int>.generate(2000, (i) => i % 256);
    final service = UpdateService(
      fetchMeta: () async => '',
      cacheDirPath: () async => dir.path,
      openApk: () async =>
          (stream: Stream.value(body), contentLength: body.length),
    );
    final valid = UpdateRelease(
        version: '1.0.2',
        versionCode: 2,
        sha256: sha256.convert(body).toString(),
        apk: 'ccferry.apk',
        notes: '');
    final model = UpdateModel(service: service, localVersion: () async => (1, '1.0.0'));
    await model.check(); // -> failed (empty meta); download() is allowed from failed
    model.release = valid;
    final progress = <double>[];
    await model.download(onProgress: progress.add);
    expect(model.phase, UpdatePhase.ready);
    expect(model.downloadedApkPath, isNotNull);
    expect(progress.last, 1.0);
  });

  test('a download failure surfaces the error and a retry can succeed', () async {
    final dir = await Directory.systemTemp.createTemp('update-model-test');
    addTearDown(() async => await dir.delete(recursive: true));
    final failing = UpdateService(
      fetchMeta: () async => '',
      cacheDirPath: () async => dir.path,
      openApk: () => throw Exception('network gone'),
    );
    final model = UpdateModel(service: failing, localVersion: () async => (1, '1.0.0'));
    await model.check(); // -> failed
    model.release = rel(2);
    await model.download();
    expect(model.phase, UpdatePhase.failed);
    expect(model.error, isNotNull);

    // Retry with a service that serves real bytes.
    final body = List<int>.generate(10, (i) => i);
    var calls = 0;
    final retry = UpdateService(
      fetchMeta: () async => '',
      cacheDirPath: () async => dir.path,
      openApk: () async {
        calls++;
        return (stream: Stream.value(body), contentLength: body.length);
      },
    );
    final good = UpdateRelease(
        version: '1',
        versionCode: 2,
        sha256: sha256.convert(body).toString(),
        apk: 'a',
        notes: '');
    final model2 = UpdateModel(service: retry, localVersion: () async => (1, 'x'));
    await model2.check(); // -> failed
    model2.release = good;
    await model2.download();
    expect(calls, 1);
    expect(model2.phase, UpdatePhase.ready);
  });

  test('dismiss stops prompting for this boot', () async {
    final model = UpdateModel(
      service: serviceWith(rel(2)),
      localVersion: () async => (1, '1.0.0'),
    );
    await model.check();
    model.dismiss();
    expect(model.dismissed, isTrue);
  });
}

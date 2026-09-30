import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_release.dart';
import 'package:ccferry_mobile/update/update_service.dart';

// -1 sentinel means "use the body length"; null passes through as "no header".
Future<(String, List<int>)> download(
  List<int> body, {
  int? contentLength = -1,
  void Function(double)? onProgress,
}) async {
  final dir = await Directory.systemTemp.createTemp('update-svc-test');
  addTearDown(() async => await dir.delete(recursive: true));
  final service = UpdateService(
    fetchMeta: () async => '',
    cacheDirPath: () async => dir.path,
    openApk: () async => (
      stream: Stream.value(body),
      contentLength: contentLength == -1 ? body.length : contentLength,
    ),
  );
  final valid = UpdateRelease(
      version: '1.0.1',
      versionCode: 2,
      sha256: sha256.convert(body).toString(),
      apk: 'ccferry.apk',
      notes: '');
  final path = await service.downloadApk(valid, onProgress: onProgress);
  return (path, await File(path).readAsBytes());
}

void main() {
  test('fetchLatest parses a good body', () async {
    final service = UpdateService(
      openApk: () => throw UnimplementedError(),
      cacheDirPath: () => throw UnimplementedError(),
      fetchMeta: () async =>
          '{"version":"1.0.1","versionCode":2,"sha256":"a","apk":"ccferry.apk"}',
    );
    expect((await service.fetchLatest())!.versionCode, 2);
  });

  test('fetchLatest swallows garbage and transport errors to null', () async {
    final garbage = UpdateService(
      openApk: () => throw UnimplementedError(),
      cacheDirPath: () => throw UnimplementedError(),
      fetchMeta: () async => '<html>502</html>',
    );
    expect(await garbage.fetchLatest(), isNull);
    final failing = UpdateService(
      openApk: () => throw UnimplementedError(),
      cacheDirPath: () => throw UnimplementedError(),
      fetchMeta: () => throw Exception('offline'),
    );
    expect(await failing.fetchLatest(), isNull);
  });

  test('downloads, hashes, and lands the file at the cache path', () async {
    final body = List<int>.generate(5000, (i) => i % 256);
    final (path, written) = await download(body);
    expect(written, body);
    expect(path.endsWith('ccferry-update.apk'), isTrue);
  });

  test('reports progress up to 1.0 when content-length is known', () async {
    final seen = <double>[];
    final body = List<int>.filled(3000, 7);
    await download(body, onProgress: seen.add);
    expect(seen, isNotEmpty);
    expect(seen.first, greaterThan(0));
    expect(seen.last, 1.0);
  });

  test('completes without progress when content-length is missing', () async {
    final seen = <double>[];
    final body = List<int>.filled(3000, 7);
    final (path, written) = await download(body,
        contentLength: null, onProgress: seen.add);
    expect(written.length, 3000);
    expect(seen, isEmpty);
  });

  test('deletes the file and throws when the digest mismatches', () async {
    final dir = await Directory.systemTemp.createTemp('update-svc-test');
    addTearDown(() async => await dir.delete(recursive: true));
    final body = List<int>.filled(100, 1);
    final service = UpdateService(
      fetchMeta: () async => '',
      cacheDirPath: () async => dir.path,
      openApk: () async => (
        stream: Stream.value(body),
        contentLength: body.length,
      ),
    );
    final corrupt = UpdateRelease(
        version: '1', versionCode: 2, sha256: 'deadbeef', apk: 'a', notes: '');
    await expectLater(
      service.downloadApk(corrupt),
      throwsA(isA<UpdateVerifyException>()),
    );
    expect(File('${dir.path}/ccferry-update.apk').existsSync(), isFalse);
  });

  test('overwrites a stale partial file from a previous run', () async {
    final body = List<int>.generate(2000, (i) => i % 256);
    final dir = await Directory.systemTemp.createTemp('update-svc-test');
    addTearDown(() async => await dir.delete(recursive: true));
    final stale = File('${dir.path}/ccferry-update.apk');
    await stale.writeAsBytes(List<int>.filled(999, 9));
    final service = UpdateService(
      fetchMeta: () async => '',
      cacheDirPath: () async => dir.path,
      openApk: () async => (
        stream: Stream.value(body),
        contentLength: body.length,
      ),
    );
    final good = UpdateRelease(
        version: '1',
        versionCode: 2,
        sha256: sha256.convert(body).toString(),
        apk: 'a',
        notes: '');
    final path = await service.downloadApk(good);
    expect(await File(path).readAsBytes(), body);
  });
}

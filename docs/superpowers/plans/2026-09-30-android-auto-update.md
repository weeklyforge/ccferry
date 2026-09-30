# Android Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command publishes a release (APK + metadata) to GitHub Releases; the app silently checks on startup, prompts, downloads with progress + SHA256 verify, and hands the APK to the Android system installer.

**Architecture:** `UpdateRelease.tryParse` (tolerant latest.json decode) → `UpdateService` (fetch meta / download+hash APK; all IO behind injected closures) → `UpdateModel` (ChangeNotifier phase machine: idle→checking→available/upToDate/failed; available→downloading→ready/failed) → `UpdateDialog` on the sessions overview → `UpdateInstaller` MethodChannel → MainActivity install Intent via FileProvider. Publishing is a bash script over `flutter build` + `gh release create`; the `releases/latest/download/` alias is the only URL the app ever needs.

**Tech Stack:** Flutter/Dart (http, provider — existing; new: package_info_plus, path_provider, crypto), Kotlin (FlutterActivity + MethodChannel + androidx FileProvider), bash + GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-09-30-android-auto-update-design.md`

## Global Constraints

- All commands run from `apps/mobile` unless stated otherwise; tests: `flutter test` (suite was 87/87 green at plan time); static analysis: `flutter analyze` must stay clean.
- Code and comments in English; UI copy may be Chinese.
- versionCode (pubspec `+N`) is the sole update-comparison key; versionName is display-only.
- latest.json problems (bad JSON, missing fields, network error, non-200) must degrade to "no update, stay silent" — never block or nag the sessions UI.
- No tokens or keys anywhere in script or app code; `gh` CLI carries publish auth.
- New pub dependencies limited to: `package_info_plus`, `path_provider`, `crypto`.
- The first-ever `git push` / `gh repo create` (Task 8) requires explicit owner confirmation in the conversation before it runs.
- Commits: conventional subject + markdown bullet body, no Co-Authored-By, no push.

## Review Focus

Input classes the spec implies but task tests don't naturally cover — each is pinned by the named task's test:

1. latest.json URL answers with an HTML error/captive-portal page instead of JSON → must parse-fail to "no update" silently (Task 1: `garbage input returns null`; Task 2: fetch exception → null).
2. APK download truncated mid-stream → SHA mismatch → file deleted, install never offered (Task 2: `deletes the file and throws when the digest mismatches`).
3. Server omits content-length (chunked) → download must still complete; progress simply stays 0 (Task 2: `completes without progress when content-length is missing`).
4. A partial file left in cache by a previous killed run → must be overwritten, never reused (Task 2: `overwrites a stale partial file`).
5. Install permission not granted on first update → app must not crash and must route the user to the grant screen, with a retry (Task 4 pins the `need_permission` Dart contract; on-device grant flow is Task 8's manual checklist).

---

### Task 1: UpdateRelease — tolerant latest.json model

**Files:**
- Create: `lib/update/update_release.dart`
- Test: `test/update/update_release_test.dart`

**Interfaces:**
- Consumes: nothing (leaf).
- Produces: `class UpdateRelease { final String version; final int versionCode; final String sha256; final String apk; final String notes; }` and `static UpdateRelease? tryParse(String raw)` — returns null for anything not exactly the documented shape.

- [ ] **Step 1: Write the failing tests**

```dart
// test/update/update_release_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_release.dart';

void main() {
  test('parses a full metadata document', () {
    final r = UpdateRelease.tryParse(
        '{"version":"1.0.1","versionCode":2,"sha256":"abc","apk":"ccferry.apk","notes":"- a"}');
    expect(r, isNotNull);
    expect(r!.version, '1.0.1');
    expect(r.versionCode, 2);
    expect(r.sha256, 'abc');
    expect(r.apk, 'ccferry.apk');
    expect(r.notes, '- a');
  });

  test('notes are optional and default to empty', () {
    final r = UpdateRelease.tryParse(
        '{"version":"1.0.1","versionCode":2,"sha256":"abc","apk":"ccferry.apk"}');
    expect(r!.notes, '');
  });

  test('non-json garbage (error page, captive portal) yields null', () {
    expect(UpdateRelease.tryParse('<html>502 Bad Gateway</html>'), isNull);
  });

  test('missing required fields yield null', () {
    expect(UpdateRelease.tryParse('{"version":"1.0.1","sha256":"a","apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"versionCode":2,"sha256":"a","apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"version":"1.0.1","versionCode":2,"apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"version":"1.0.1","versionCode":2,"sha256":"a"}'), isNull);
  });

  test('a non-integer versionCode yields null (tolerant of 2.0 writes)', () {
    expect(
        UpdateRelease.tryParse(
            '{"version":"1.0.1","versionCode":2.0,"sha256":"a","apk":"x"}'),
        isNull);
  });

  test('a json array or scalar yields null', () {
    expect(UpdateRelease.tryParse('[1,2]'), isNull);
    expect(UpdateRelease.tryParse('"ok"'), isNull);
  });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/update/update_release_test.dart`
Expected: FAIL — `update_release.dart` does not exist (compile error naming the missing import).

- [ ] **Step 3: Implement**

```dart
// lib/update/update_release.dart
import 'dart:convert';

/// One published release, as described by the latest.json release asset
/// (spec section 4). versionCode is the only comparison key; everything else
/// is display or integrity data.
class UpdateRelease {
  const UpdateRelease({
    required this.version,
    required this.versionCode,
    required this.sha256,
    required this.apk,
    required this.notes,
  });

  final String version;
  final int versionCode;
  final String sha256;
  final String apk;
  final String notes;

  /// Tolerant decode: anything short of the exact documented shape (bad JSON,
  /// an HTML error page, missing fields, a float versionCode) yields null and
  /// the caller treats it as "no update".
  static UpdateRelease? tryParse(String raw) {
    try {
      final value = jsonDecode(raw);
      if (value is! Map<String, dynamic>) return null;
      final version = value['version'];
      final code = value['versionCode'];
      final sha = value['sha256'];
      final apk = value['apk'];
      if (version is! String || code is! int) return null;
      if (sha is! String || apk is! String) return null;
      return UpdateRelease(
        version: version,
        versionCode: code,
        sha256: sha,
        apk: apk,
        notes: value['notes'] is String ? value['notes'] as String : '',
      );
    } catch (_) {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `flutter test test/update/update_release_test.dart`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/update/update_release.dart test/update/update_release_test.dart
git commit -m "feat(mobile): tolerant latest.json model for update checks" -m "- UpdateRelease.tryParse decodes the release metadata asset
- any deviation from the documented shape yields null (silent no-update)"
```

---

### Task 2: UpdateService — meta fetch and verified download

**Files:**
- Create: `lib/update/update_service.dart`
- Test: `test/update/update_service_test.dart`

**Interfaces:**
- Consumes: `UpdateRelease.tryParse` (Task 1).
- Produces:
  - `typedef MetaFetcher = Future<String> Function();`
  - `typedef ApkStream = ({Stream<List<int>> stream, int? contentLength});`
  - `typedef ApkOpener = Future<ApkStream> Function();`
  - `class UpdateVerifyException implements Exception` — thrown when the downloaded digest mismatches; the file is already deleted when it propagates.
  - `UpdateService({required MetaFetcher fetchMeta, required ApkOpener openApk, required Future<String> Function() cacheDirPath})`
  - `Future<UpdateRelease?> fetchLatest()` — null on parse failure OR thrown fetchMeta (never throws).
  - `Future<String> downloadApk(UpdateRelease release, {void Function(double progress)? onProgress})` — writes `<cacheDir>/ccferry-update.apk`, reports progress in 0..1 (only when content-length is known and positive), verifies sha256, returns the file path; deletes the file and throws `UpdateVerifyException` on mismatch.
  - `factory UpdateService.github({http.Client? client})` — real transport against `https://github.com/fetaoily/ccferry/releases/latest/download/{latest.json,ccferry.apk}`; non-200 or transport error behaves as null/throw per the contracts above. (Thin glue, covered by the end-to-end run in Task 8, not unit-tested.)

- [ ] **Step 1: Write the failing tests**

```dart
// test/update/update_service_test.dart
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
```

Note: the second fetchLatest test constructs the service with throwing seams it never calls — that is deliberate, the constructor requires all three closures.

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/update/update_service_test.dart`
Expected: FAIL — `update_service.dart` does not exist.

- [ ] **Step 3: Implement**

```dart
// lib/update/update_service.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'package:ccferry_mobile/update/update_release.dart';

typedef MetaFetcher = Future<String> Function();

/// A opened APK body plus the declared length (null when the server sent no
/// usable content-length, e.g. chunked transfer).
typedef ApkStream = ({Stream<List<int>> stream, int? contentLength});
typedef ApkOpener = Future<ApkStream> Function();

/// Thrown by [UpdateService.downloadApk] when the downloaded bytes do not
/// match the published sha256. The partial file is deleted before this
/// propagates — the caller must never see a bad file on disk.
class UpdateVerifyException implements Exception {
  const UpdateVerifyException();
  @override
  String toString() => 'downloaded apk failed the sha256 check';
}

/// Update transport. All IO sits behind injected closures so tests drive
/// bytes directly; [UpdateService.github] is the real wiring.
class UpdateService {
  UpdateService({
    required MetaFetcher fetchMeta,
    required ApkOpener openApk,
    required Future<String> Function() cacheDirPath,
  })  : _fetchMeta = fetchMeta,
        _openApk = openApk,
        _cacheDirPath = cacheDirPath;

  factory UpdateService.github({http.Client? client}) {
    final inner = client ?? http.Client();
    Uri metaUrl() => Uri.parse(
        'https://github.com/fetaoily/ccferry/releases/latest/download/latest.json');
    Uri apkUrl() => Uri.parse(
        'https://github.com/fetaoily/ccferry/releases/latest/download/ccferry.apk');
    return UpdateService(
      fetchMeta: () async {
        final r = await inner.get(metaUrl()).timeout(const Duration(seconds: 10));
        if (r.statusCode != 200) throw http.ClientException('status ${r.statusCode}');
        return r.body;
      },
      openApk: () async {
        final r =
            await inner.send(http.Request('GET', apkUrl())).timeout(const Duration(minutes: 10));
        if (r.statusCode != 200) throw http.ClientException('status ${r.statusCode}');
        final len = r.contentLength;
        return (stream: r.stream, contentLength: len != null && len > 0 ? len : null);
      },
      cacheDirPath: () async => (await getTemporaryDirectory()).path,
    );
  }

  final MetaFetcher _fetchMeta;
  final ApkOpener _openApk;
  final Future<String> Function() _cacheDirPath;

  /// Null on any problem (bad body, offline) — the caller reads that as
  /// "no update, stay silent". Never throws.
  Future<UpdateRelease?> fetchLatest() async {
    try {
      return UpdateRelease.tryParse(await _fetchMeta());
    } catch (_) {
      return null;
    }
  }

  /// Downloads to `<cacheDir>/ccferry-update.apk`, hashing on the fly.
  /// Returns the file path after the digest matches [release.sha256];
  /// on mismatch the file is deleted and [UpdateVerifyException] thrown.
  Future<String> downloadApk(
    UpdateRelease release, {
    void Function(double progress)? onProgress,
  }) async {
    final dir = await _cacheDirPath();
    final file = File('$dir/ccferry-update.apk');
    final (stream, contentLength) = await _openApk();

    late Digest digest;
    final hasher = sha256.startChunkedConversion(
      ChunkedConversionSink<Digest>.withCallback((d) => digest = d.single),
    );
    final sink = file.openWrite();
    try {
      var received = 0;
      await for (final chunk in stream) {
        hasher.add(chunk);
        sink.add(chunk);
        received += chunk.length;
        final len = contentLength;
        if (len != null && len > 0) onProgress?.call(received / len);
      }
    } finally {
      hasher.close();
      await sink.flush();
      await sink.close();
    }

    if (digest.toString() != release.sha256.toLowerCase()) {
      try {
        await file.delete();
      } catch (_) {}
      throw const UpdateVerifyException();
    }
    return file.path;
  }
}
```

Note: `getTemporaryDirectory` comes from `path_provider` — add dependencies first (this step):

Run: `flutter pub add package_info_plus path_provider crypto`
Expected: pubspec.yaml gains the three packages, `flutter pub get` succeeds.

- [ ] **Step 4: Run to verify they pass**

Run: `flutter test test/update/update_service_test.dart`
Expected: PASS (7/7).

- [ ] **Step 5: Full suite**

Run: `flutter test`
Expected: all pass (existing 87 + new 13).

- [ ] **Step 6: Commit**

```bash
git add pubspec.yaml pubspec.lock lib/update/update_service.dart test/update/update_service_test.dart
git commit -m "feat(mobile): update transport with sha256-verified apk download" -m "- UpdateService fetches latest.json through a tolerant closure seam
- downloadApk streams to the cache dir with progress and an on-the-fly sha256
- digest mismatch deletes the partial file and throws UpdateVerifyException
- UpdateService.github wires the releases/latest/download aliases
- new deps: package_info_plus, path_provider, crypto"
```

---

### Task 3: UpdateModel — the phase machine

**Files:**
- Create: `lib/update/update_model.dart`
- Test: `test/update/update_model_test.dart`

**Interfaces:**
- Consumes: `UpdateService` (Task 2).
- Produces:
  - `enum UpdatePhase { idle, checking, upToDate, available, downloading, ready, failed }`
  - `UpdateModel({required UpdateService service, required Future<(int, String)> Function() localVersion})` — the seam returns `(versionCode, versionName)` of the running app.
  - Getters: `phase`, `release` (UpdateRelease?), `progress` (double 0..1), `error` (String?), `dismissed` (bool), `localLabel` (String).
  - `Future<void> check()` — sets checking, fetches, resolves to `available` (remote versionCode strictly greater), `upToDate` (remote ≤ local), or `failed` (fetchLatest null — stays silent by convention, UI renders nothing for it). Never throws. Re-checks are allowed from idle/failed/upToDate but must not disturb `downloading`/`ready`.
  - `Future<void> download()` — allowed from `available` and `failed` (retry); reports progress via notifyListeners; ends `ready` or `failed` (with `error` set).
  - `void dismiss()` — sets `dismissed = true` (UI: this boot stops prompting).

- [ ] **Step 1: Write the failing tests**

```dart
// test/update/update_model_test.dart
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
```

Note the two seams the tests rely on: the public `set release(...)` (inject a release without a real fetch) and `download({void Function(double)? onProgress})` (observe progress without listening to notifyListeners).

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/update/update_model_test.dart`
Expected: FAIL — `update_model.dart` does not exist.

- [ ] **Step 3: Implement**

```dart
// lib/update/update_model.dart
import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/update/update_release.dart';
import 'package:ccferry_mobile/update/update_service.dart';

enum UpdatePhase { idle, checking, upToDate, available, downloading, ready, failed }

/// Phase machine for the in-app updater (spec section 5). `failed` after a
/// check is silent by convention — the UI renders nothing for it; `failed`
/// after a download is surfaced with [error] and retried via download().
class UpdateModel extends ChangeNotifier {
  UpdateModel({
    required UpdateService service,
    required Future<(int, String)> Function() localVersion,
  })  : _service = service,
        _localVersion = localVersion;

  final UpdateService _service;
  final Future<(int, String)> Function() _localVersion;

  UpdatePhase _phase = UpdatePhase.idle;
  UpdateRelease? _release;
  double _progress = 0;
  String? _error;
  String? _downloadedApkPath;
  bool _dismissed = false;
  String _localLabel = '';

  UpdatePhase get phase => _phase;
  UpdateRelease? get release => _release;
  double get progress => _progress;
  String? get error => _error;
  String? get downloadedApkPath => _downloadedApkPath;
  bool get dismissed => _dismissed;
  String get localLabel => _localLabel;

  /// Test seam: inject a release as if a check had produced it.
  set release(UpdateRelease? r) => _release = r;

  Future<void> check() async {
    if (_phase == UpdatePhase.downloading || _phase == UpdatePhase.ready) return;
    _dismissed = false;
    _phase = UpdatePhase.checking;
    notifyListeners();

    final (code, name) = await _localVersion();
    _localLabel = name;
    final r = await _service.fetchLatest();
    if (r == null) {
      _phase = UpdatePhase.failed; // silent: no UI for a failed check
    } else if (r.versionCode > code) {
      _release = r;
      _phase = UpdatePhase.available;
    } else {
      _phase = UpdatePhase.upToDate;
    }
    notifyListeners();
  }

  Future<void> download({void Function(double progress)? onProgress}) async {
    final r = _release;
    if (r == null ||
        (_phase != UpdatePhase.available && _phase != UpdatePhase.failed)) {
      return;
    }
    _phase = UpdatePhase.downloading;
    _progress = 0;
    _error = null;
    notifyListeners();
    try {
      _downloadedApkPath = await _service.downloadApk(
        r,
        onProgress: (p) {
          _progress = p;
          notifyListeners();
          onProgress?.call(p);
        },
      );
      _phase = UpdatePhase.ready;
    } catch (e) {
      _error = e.toString();
      _phase = UpdatePhase.failed;
    }
    notifyListeners();
  }

  void dismiss() {
    _dismissed = true;
    notifyListeners();
  }

  /// Test seam: pretend a download finished with this path (used by the
  /// dialog tests to reach the ready state without real bytes).
  void debugCompleteDownload(String path) {
    _downloadedApkPath = path;
    _phase = UpdatePhase.ready;
    notifyListeners();
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `flutter test test/update/update_model_test.dart`
Expected: PASS (6/6).

- [ ] **Step 5: Full suite**

Run: `flutter test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/update/update_model.dart test/update/update_model_test.dart
git commit -m "feat(mobile): update phase machine with silent-failure semantics" -m "- UpdateModel drives checking/available/downloading/ready/failed
- a failed metadata check stays silent; a failed download is retryable
- dismiss() stops prompting for the current boot"
```

---

### Task 4: Installer bridge — MethodChannel, FileProvider, permissions

**Files:**
- Create: `lib/update/update_installer.dart`
- Create: `android/app/src/main/res/xml/file_paths.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/kotlin/com/fetaoily/ccferry/MainActivity.kt`
- Test: `test/update/update_installer_test.dart`

**Interfaces:**
- Consumes: nothing native until MainActivity registers `ccferry/install`.
- Produces:
  - `class UpdateInstaller({MethodChannel channel = const MethodChannel('ccferry/install')})` with:
    - `Future<String> installApk(String path)` — resolves `'started'` when the system installer launched, `'need_permission'` when the "install unknown apps" grant is missing.
    - `Future<void> openPermissionSettings()` — opens the grant screen for this app.
  - Native channel methods (Kotlin): `installApk {path}` → `success("started" | "need_permission")` or `error(code, msg)`; `openInstallPermissionSettings` → `success(null)`.

- [ ] **Step 1: Write the failing test**

```dart
// test/update/update_installer_test.dart
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_installer.dart';

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
```

`testerBinding` — declare once above the tests:

```dart
final testerBinding = TestDefaultBinaryMessengerBinding.instance;
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/update/update_installer_test.dart`
Expected: FAIL — `update_installer.dart` does not exist.

- [ ] **Step 3: Implement the Dart side**

```dart
// lib/update/update_installer.dart
import 'package:flutter/services.dart';

/// Bridge to the Android package installer. The native side decides between
/// launching the installer directly and sending the user to the
/// "install unknown apps" grant first; the verdict comes back as a string so
/// the dialog can guide the retry.
class UpdateInstaller {
  UpdateInstaller({this.channel = const MethodChannel('ccferry/install')});

  final MethodChannel channel;

  /// Returns 'started' or 'need_permission'.
  Future<String> installApk(String path) async {
    final verdict = await channel.invokeMethod<String>(
        'installApk', {'path': path});
    return verdict ?? 'started';
  }

  Future<void> openPermissionSettings() =>
      channel.invokeMethod<void>('openInstallPermissionSettings');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `flutter test test/update/update_installer_test.dart`
Expected: PASS (3/3).

- [ ] **Step 5: Native side — manifest, file_paths, MainActivity**

`android/app/src/main/res/xml/file_paths.xml` (new file):

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Exposes only the app cache dir so FileProvider can hand the downloaded
     apk to the system installer. -->
<paths>
    <cache-path name="update" path="." />
</paths>
```

`android/app/src/main/AndroidManifest.xml` — two additions (leave everything else untouched):
after the existing `POST_NOTIFICATIONS` permission:

```xml
    <!-- In-app update: lets the app hand a downloaded apk to the package
         installer. Side-loaded distribution only; no store review impact. -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
```

inside `<application>` (after the `<activity>` element):

```xml
        <!-- Shares the downloaded update apk with the system installer. -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
```

`MainActivity.kt` — full replacement:

```kotlin
package com.fetaoily.ccferry

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    // In-app update bridge (spec section 5): hand a verified apk to the
    // system installer, or route to the install-permission grant first.
    private val installChannel = "ccferry/install"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, installChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "installApk" -> {
                        val path = call.argument<String>("path")
                        if (path == null) {
                            result.error("invalid_args", "path is required", null)
                        } else {
                            try {
                                result.success(installApk(path))
                            } catch (e: Exception) {
                                result.error("install_failed", e.message, null)
                            }
                        }
                    }
                    "openInstallPermissionSettings" -> {
                        openPermissionSettings()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    // On Android 8+ a missing install grant is detected up front and reported
    // back as "need_permission" so the Dart dialog can guide the user; the
    // grant screen itself opens via openPermissionSettings().
    private fun installApk(path: String): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            return "need_permission"
        }
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", File(path))
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        return "started"
    }

    private fun openPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
    }
}
```

- [ ] **Step 6: Verify the native build compiles**

Run: `flutter build apk --debug`
Expected: BUILD SUCCESSFUL — this proves androidx.core/FileProvider resolve on the compile classpath. If `androidx.core.content.FileProvider` fails to resolve, add `implementation("androidx.core:core-ktx:1.13.1")` to `android/app/build.gradle.kts` `dependencies {}` (create the block) and rebuild — record the deviation in the ledger.

- [ ] **Step 7: Full suite + analyze**

Run: `flutter test && flutter analyze`
Expected: all pass, no analyzer issues.

- [ ] **Step 8: Commit**

```bash
git add lib/update/update_installer.dart test/update/update_installer_test.dart android/app/src/main/res/xml/file_paths.xml android/app/src/main/AndroidManifest.xml android/app/src/main/kotlin/com/fetaoily/ccferry/MainActivity.kt
git commit -m "feat(mobile): android installer bridge for in-app updates" -m "- UpdateInstaller MethodChannel returns started or need_permission
- MainActivity launches the system installer through FileProvider
- REQUEST_INSTALL_PACKAGES permission and cache-path FileProvider declared
- missing install grant routes to the unknown-app-sources settings screen"
```

---

### Task 5: UpdateDialog + sessions overview wiring

**Files:**
- Create: `lib/update/update_dialog.dart`
- Modify: `lib/pages/sessions_page.dart`
- Test: `test/pages/sessions_page_test.dart` (extend)

**Interfaces:**
- Consumes: `UpdateModel` (Task 3), `UpdateInstaller` (Task 4).
- Produces:
  - `class UpdateDialog extends StatefulWidget` with `static Future<void> showIfAvailable(BuildContext context)` — no-op unless the model is `available` and not `dismissed`.
  - Dialog states by phase: `available` → notes + 【以后再说】【下载更新】; `downloading` → progress bar + percentage; `ready` → 【立即安装】 (auto-invoked once on entry); `failed` (after download) → error + 【重试】.
  - `need_permission` verdict → guidance text 【去授权】 (calls `openPermissionSettings`) + keep 【立即安装】 for the retry.
  - SessionsPage: after the first frame, runs `check()` once and calls `UpdateDialog.showIfAvailable`.
  - Test harness change: `harness()` gains `UpdateModel? update` (default: a silent model whose fetch yields null — existing tests must stay green untouched).

- [ ] **Step 1: Write the failing tests**

First the harness changes — `test/pages/sessions_page_test.dart` gains imports (`package:ccferry_mobile/update/update_dialog.dart`, `package:ccferry_mobile/update/update_installer.dart`, `package:ccferry_mobile/update/update_model.dart`, `package:ccferry_mobile/update/update_release.dart`, `package:ccferry_mobile/update/update_service.dart`, `package:flutter/services.dart`), a top-level metadata-driven model factory, and an optional provider:

```dart
// A model that reaches `available` through the real check() path (SessionsPage's
// initState drives it): fetchMeta serves the given release, or '' -> null.
UpdateModel updateWithMeta(UpdateRelease? meta) => UpdateModel(
      service: UpdateService(
        fetchMeta: () async => meta == null
            ? ''
            : '{"version":"${meta.version}","versionCode":${meta.versionCode},'
                '"sha256":"${meta.sha256}","apk":"${meta.apk}","notes":"${meta.notes}"}',
        openApk: () => throw UnimplementedError(),
        cacheDirPath: () => throw UnimplementedError(),
      ),
      localVersion: () async => (1, '1.0.0'),
    );

const newerRelease = UpdateRelease(
    version: '9.9.9', versionCode: 99, sha256: 'a', apk: 'ccferry.apk', notes: '- 修复大问题');

Widget harness({required ApprovalsModel approvals, required SessionsModel model, ApiClient? client, UpdateModel? update}) =>
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: client!),
        ChangeNotifierProvider<AuthModel>.value(value: AuthModel(store: MemoryStore())),
        ChangeNotifierProvider<ApprovalsModel>.value(value: approvals),
        ChangeNotifierProvider<SessionsModel>.value(value: model),
        ChangeNotifierProvider<ConnectionModel>.value(value: ConnectionModel()),
        ChangeNotifierProvider<UpdateModel>.value(value: update ?? updateWithMeta(null)),
      ],
      child: const MaterialApp(home: SessionsPage()),
    );
```

Tests must reach `available` through the real `check()` (run by SessionsPage's initState postFrame callback) — a hand-injected release alone leaves the phase at idle and the dialog would never open.

Then inside `main()`:

```dart
  testWidgets('prompts with release notes when a newer version exists', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle(); // the page auto-check resolves -> available -> dialog

    expect(find.textContaining('发现新版本 9.9.9'), findsOneWidget);
    expect(find.textContaining('- 修复大问题'), findsOneWidget);
  });

  testWidgets('no dialog when the check fails silently', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(null); // fetchMeta returns '' -> failed (silent)

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    expect(find.textContaining('发现新版本'), findsNothing);
  });

  testWidgets('later button dismisses for this boot', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    await tester.tap(find.text('以后再说'));
    await tester.pumpAndSettle();

    expect(find.textContaining('发现新版本'), findsNothing);
    expect(update.dismissed, isTrue);
  });

  testWidgets('download button starts the download and shows progress', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    // A real check to available, then a download that never completes: the
    // dialog must sit in the progress state.
    final hanging = UpdateService(
      fetchMeta: () async =>
          '{"version":"9.9.9","versionCode":99,"sha256":"a","apk":"ccferry.apk","notes":"n"}',
      cacheDirPath: () async => '/unused',
      openApk: () => Completer<({Stream<List<int>> stream, int? contentLength})>().future,
    );
    final update = UpdateModel(service: hanging, localVersion: () async => (1, '1.0.0'));

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    await tester.tap(find.text('下载更新'));
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('以后再说'), findsNothing); // cannot back out mid-download
  });

  testWidgets('the ready state auto-fires the installer exactly once', (tester) async {
    final client = routedClient(onLoad: (_) {});
    final approvals = ApprovalsModel(client: client);
    final model = SessionsModel(client: client, approvals: approvals);
    final update = updateWithMeta(newerRelease);
    var installCalls = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ccferry/install'), (call) async {
      installCalls++;
      return 'started';
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('ccferry/install'), null));

    await tester.pumpWidget(harness(approvals: approvals, model: model, client: client, update: update));
    await tester.pumpAndSettle();

    // Jump straight to ready via the Task 3 test seam: the dialog enters the
    // ready state, auto-fires the installer once, and stays open on the
    // "installing" affordance (the system installer takes over on device).
    update.debugCompleteDownload('/cache/ccferry-update.apk');
    await tester.pumpAndSettle();

    expect(installCalls, 1);
    expect(find.text('立即安装'), findsOneWidget);
  });
```

The auto-fire test relies on `debugCompleteDownload`, which Task 3 already added to `UpdateModel`.

- [ ] **Step 2: Run to verify they fail**

Run: `flutter test test/pages/sessions_page_test.dart`
Expected: FAIL — no `update` parameter on harness / no dialog text found (compile error naming missing `update_dialog.dart`).

- [ ] **Step 3: Implement the dialog**

```dart
// lib/update/update_dialog.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/update/update_installer.dart';
import 'package:ccferry_mobile/update/update_model.dart';

/// The one update prompt per boot. States mirror the model phases; a
/// need_permission verdict swaps the install button for a grant button but
/// keeps the flow on the same dialog.
class UpdateDialog extends StatefulWidget {
  const UpdateDialog({super.key});

  static Future<void> showIfAvailable(BuildContext context) async {
    final update = context.read<UpdateModel>();
    if (update.dismissed || update.phase != UpdatePhase.available) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const UpdateDialog(),
    );
  }

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  final UpdateInstaller _installer = UpdateInstaller();
  bool _autoInstallFired = false;
  bool _needPermission = false;

  void _install() async {
    final update = context.read<UpdateModel>();
    final path = update.downloadedApkPath;
    if (path == null) return;
    try {
      final verdict = await _installer.installApk(path);
      if (!mounted) return;
      if (verdict == 'need_permission') {
        setState(() => _needPermission = true);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _needPermission = false);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('无法启动安装器')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final update = context.watch<UpdateModel>();
    final release = update.release;

    // Auto-fire the installer once the download lands (spec section 5);
    // need_permission keeps the dialog open with guidance instead.
    if (update.phase == UpdatePhase.ready && !_autoInstallFired) {
      _autoInstallFired = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_needPermission) _install();
      });
    }

    final title = release == null ? const Text('发现新版本') : Text('发现新版本 ${release.version}（当前 ${update.localLabel}）');

    Widget content = Text(release?.notes ?? '');
    List<Widget> actions = [
      TextButton(
        onPressed: () {
          context.read<UpdateModel>().dismiss();
          Navigator.of(context).pop();
        },
        child: const Text('以后再说'),
      ),
    ];

    switch (update.phase) {
      case UpdatePhase.downloading:
        content = Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            LinearProgressIndicator(value: update.progress <= 0 ? null : update.progress),
            const SizedBox(height: 8),
            Text('${(update.progress * 100).toStringAsFixed(0)}%'),
          ],
        );
        actions = const [];
      case UpdatePhase.ready:
        content = Text(_needPermission
            ? '需要"安装未知应用"权限才能安装更新，点击去授权后重试'
            : '下载完成，正在打开安装器…');
      case UpdatePhase.failed:
        content = Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(release?.notes ?? ''),
            const SizedBox(height: 8),
            Text('下载失败：${update.error ?? '未知错误'}',
                style: const TextStyle(color: Colors.red)),
          ],
        );
        actions = [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('以后再说'),
          ),
          TextButton(
            onPressed: () => context.read<UpdateModel>().download(),
            child: const Text('重试'),
          ),
        ];
      default:
        break;
    }

    if (update.phase == UpdatePhase.available ||
        update.phase == UpdatePhase.idle ||
        update.phase == UpdatePhase.checking) {
      actions = [
        ...actions,
        TextButton(
          onPressed: () => context.read<UpdateModel>().download(),
          child: const Text('下载更新'),
        ),
      ];
    }
    if (update.phase == UpdatePhase.ready) {
      actions = [
        if (_needPermission)
          TextButton(
            onPressed: () => _installer.openPermissionSettings(),
            child: const Text('去授权'),
          ),
        TextButton(
          onPressed: _install,
          child: const Text('立即安装'),
        ),
      ];
    }

    return AlertDialog(title: title, content: content, actions: actions);
  }
}
```

- [ ] **Step 4: Wire the check into SessionsPage**

`lib/pages/sessions_page.dart` — imports gain `package:ccferry_mobile/update/update_dialog.dart` and `package:ccferry_mobile/update/update_model.dart`; in `initState`'s existing `addPostFrameCallback` add the update check; new method:

```dart
  // One silent update check per boot (spec section 5): fetch metadata, and
  // only surface anything when a strictly newer versionCode exists.
  Future<void> _checkUpdates() async {
    final update = context.read<UpdateModel>();
    await update.check();
    if (mounted) await UpdateDialog.showIfAvailable(context);
  }
```

and in `initState`:

```dart
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _listenEvents();
      if (mounted) _checkUpdates();
    });
```

- [ ] **Step 5: Run the page tests to green, then the full suite**

Run: `flutter test test/pages/sessions_page_test.dart` → expected PASS (all existing + 5 new).
Run: `flutter test` → all pass.

- [ ] **Step 6: Analyze and commit**

Run: `flutter analyze` → clean.

```bash
git add lib/update/update_dialog.dart lib/pages/sessions_page.dart lib/update/update_model.dart test/pages/sessions_page_test.dart
git commit -m "feat(mobile): update prompt dialog on the sessions overview" -m "- UpdateDialog renders notes, progress, retry, and install states
- need_permission swaps install for a grant-settings shortcut
- sessions overview runs one silent check per boot and prompts once
- debugCompleteDownload test seam on UpdateModel for the ready state"
```

---

### Task 6: App wiring — real service, package info, provider

**Files:**
- Modify: `lib/main.dart`

**Interfaces:**
- Consumes: `UpdateModel`, `UpdateService.github()` (Task 2/3).
- Produces: app-lifetime `UpdateModel` provided on the sessions home scope (alongside ConnectionModel), built with `UpdateService.github()` and `localVersion` from `package_info_plus` (`buildNumber` as int, `version` as label).

- [ ] **Step 1: Implement (thin glue — covered by Tasks 5's widget tests for behavior and Task 8 end-to-end for transport)**

`lib/main.dart`:

```dart
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'package:ccferry_mobile/update/update_model.dart';
import 'package:ccferry_mobile/update/update_service.dart';
```

Field on `_CcferryAppState` (next to `_connection`):

```dart
  // App-lifetime: one update check per boot, survives page rebuilds.
  late final UpdateModel _update = UpdateModel(
    service: UpdateService.github(),
    localVersion: () async {
      final info = await PackageInfo.fromPlatform();
      return (int.parse(info.buildNumber), info.version);
    },
  );
```

In `_sessionsHome()`'s providers list, add:

```dart
        ChangeNotifierProvider<UpdateModel>.value(value: _update),
```

- [ ] **Step 2: Verify**

Run: `flutter analyze && flutter test`
Expected: analyze clean, suite green.

Run: `flutter build apk --release`
Expected: BUILD SUCCESSFUL (this is also the APK that later tasks publish; keep it).

- [ ] **Step 3: Commit**

```bash
git add lib/main.dart
git commit -m "feat(mobile): wire the real update service into the app shell" -m "- app-lifetime UpdateModel on the sessions home provider scope
- local version sourced from package_info_plus at check time"
```

---

### Task 7: release.sh — the one-command publish

**Files:**
- Create: `scripts/release.sh`

**Interfaces:**
- Consumes: `gh` CLI (authenticated), `flutter`, `sha256sum`, `curl` on PATH.
- Produces: a GitHub release `v<name>` with assets `ccferry.apk` + `latest.json` (published names — the debug-staged copies, not `app-release.apk`).

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Publish a release: build the apk, hash it, and upload the apk plus update
# metadata to GitHub Releases. Usage:
#   scripts/release.sh "<release notes>"
# The version comes from pubspec.yaml (X.Y.Z+N); N (versionCode) must be
# strictly greater than the currently published metadata.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="fetaoily/ccferry"
META_URL="https://github.com/$REPO/releases/latest/download/latest.json"
APK="build/app/outputs/flutter-apk/app-release.apk"

die() { echo "error: $*" >&2; exit 1; }

NOTES="${1:-}"
[ -n "$NOTES" ] || die "usage: release.sh \"<release notes>\""
case "$NOTES" in *'"'*) die "release notes must not contain double quotes (json escaping)";; esac

# 1. Version from pubspec.
spec=$(grep -E '^version:' pubspec.yaml | head -n1 | sed -E 's/^version:[[:space:]]*//')
name=${spec%+*}
code=${spec##*+}
printf '%s' "$name" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "unparsable pubspec version: $spec"
printf '%s' "$code" | grep -Eq '^[0-9]+$' || die "unparsable pubspec versionCode: $spec"

# 2. versionCode must increase over what is published.
remote=$(curl -fsSL "$META_URL" 2>/dev/null || true)
if [ -n "$remote" ]; then
  remote_code=$(printf '%s' "$remote" | grep -oE '"versionCode":[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | tail -n1)
  [ -n "$remote_code" ] || die "cannot parse versionCode from the published latest.json"
  [ "$code" -gt "$remote_code" ] || die "versionCode $code must be greater than the published $remote_code (bump the +N in pubspec.yaml)"
fi

# 3. The tag must be new.
gh release view "v$name" --repo "$REPO" >/dev/null 2>&1 && die "release v$name already exists"

# 4. Build.
flutter build apk --release

# 5. Hash and stage assets under their published names.
sha=$(sha256sum "$APK" | cut -d' ' -f1)
stage=$(mktemp -d)
cp "$APK" "$stage/ccferry.apk"
cat > "$stage/latest.json" <<EOF
{
  "version": "$name",
  "versionCode": $code,
  "sha256": "$sha",
  "apk": "ccferry.apk",
  "notes": "$NOTES"
}
EOF

# 6. Publish.
gh release create "v$name" --repo "$REPO" --title "$name" --notes "$NOTES" \
  "$stage/ccferry.apk" "$stage/latest.json"
echo "published v$name (versionCode $code, sha256 $sha)"
```

- [ ] **Step 2: Verify the usage guard (the versionCode guard needs a published release to compare against — it is verified in Task 8)**

Run: `bash scripts/release.sh ""`
Expected: `error: usage: release.sh "<release notes>"`, exit 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/release.sh
git commit -m "feat(mobile): one-command release publishing to GitHub Releases" -m "- release.sh builds, hashes, and uploads the apk plus latest.json
- guards: non-empty notes without quotes, versionCode must increase, tag must be new
- assets staged under their published names (ccferry.apk)"
```

---

### Task 8: Repo publication (OWNER GATE) + first release + phone acceptance

**Files:**
- Modify: `pubspec.yaml` (version bump to `1.0.1+2`)
- No code.

**Interfaces:**
- Consumes: everything above.
- Produces: public repo `fetaoily/ccferry` on GitHub, release `v1.0.1` with `ccferry.apk` + `latest.json`, and a phone verified end-to-end.

- [ ] **Step 1: Pre-push secret scan**

Run: `git log --all --pretty=format: --name-only | sort -u | grep -iE '\.(jks|keystore|p8|pem|env)$|service-account|secret|credential' || echo CLEAN`
Expected: `CLEAN` (or a list that is reviewed and explained — nothing credential-like is expected in this repo's history; anything found STOPS this task).

Also confirm: `git status --porcelain` shows only the known generated-plugin noise (linux/macos/windows registrant files) — leave those uncommitted, they are build artifacts.

- [ ] **Step 2: OWNER CONFIRMATION GATE — do not proceed without an explicit yes**

Ask the owner in conversation: creating the **public** repo `fetaoily/ccferry` and pushing the full local history (all commits through this plan). Pushing is the standing rule's exception and needs their explicit approval in the moment. Record the approval in the ledger.

- [ ] **Step 3: Create the repo and push**

Run: `gh repo create fetaoily/ccferry --public --source . --push`
Expected: repo created, `main` pushed, remote `origin` set.

Run: `git log --oneline -1 && git remote -v`
Expected: HEAD matches local main tip; origin points at github.com/fetaoily/ccferry.

- [ ] **Step 4: Bump the version and publish**

Edit `pubspec.yaml`: `version: 1.0.0+1` → `version: 1.0.1+2`.

Run: `bash scripts/release.sh "- First auto-update release"`
Expected: build succeeds; output ends `published v1.0.1 (versionCode 2, sha256 ...)`.

Run: `curl -fsSL https://github.com/fetaoily/ccferry/releases/latest/download/latest.json`
Expected: the JSON with `versionCode: 2` and the matching sha256.

Run: `bash scripts/release.sh "unused"` (still on 1.0.1+2 — no bump)
Expected: `error: versionCode 2 must be greater than the published 2 (bump the +N in pubspec.yaml)`, exit 1 — the forgotten-bump guard fires against the now-real published metadata.

- [ ] **Step 5: Commit the version bump**

```bash
git add pubspec.yaml
git commit -m "chore(mobile): bump version to 1.0.1+2 for the first update release"
git push origin main
```

- [ ] **Step 6: Phone acceptance (owner-driven, USB disconnected)**

On the phone (still on 1.0.0+1, the build from M5 acceptance):
1. Open ccferry → sessions overview loads → update dialog appears: 发现新版本 1.0.1（当前 1.0.0）
2. Tap 下载更新 → progress bar fills → installer opens (first run: 去授权 → allow → back → 立即安装)
3. Complete the system install → reopen the app → no update prompt (upToDate), sessions work as before
4. Failure paths worth one look: airplane-mode start (no dialog, no crash); kill mid-download then retry (stale file overwritten)

Expected: the north-star — a new release reaches the phone and installs with no computer involved.

- [ ] **Step 7: Record the outcome**

Ledger the acceptance result and any deviations. The plan is complete when Step 6 passes.

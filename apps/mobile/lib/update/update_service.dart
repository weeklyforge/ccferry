import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'package:ccferry_mobile/update/update_release.dart';

typedef MetaFetcher = Future<String> Function();

/// A opened APK body plus the declared length (null when the server sent no
/// usable content-length, e.g. chunked transfer).
typedef ApkStream = ({Stream<List<int>> stream, int? contentLength});

/// Opens the APK body for [release]. Implementations should download from
/// the release-provided URL; the alias fallback keeps older metadata that
/// only carries a filename working.
typedef ApkOpener = Future<ApkStream> Function(UpdateRelease release);

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
    required this.fetchMeta,
    required this.openApk,
    required this.cacheDirPath,
  });

  factory UpdateService.github({http.Client? client}) {
    final inner = client ?? http.Client();
    Uri metaUrl() => Uri.parse(
        'https://github.com/weeklyforge/ccferry/releases/latest/download/latest.json');
    // Fallback for metadata that carries a bare filename instead of a URL.
    Uri aliasApkUrl() => Uri.parse(
        'https://github.com/weeklyforge/ccferry/releases/latest/download/ccferry.apk');
    return UpdateService(
      fetchMeta: () async {
        final r = await inner.get(metaUrl()).timeout(const Duration(seconds: 10));
        if (r.statusCode != 200) throw http.ClientException('status ${r.statusCode}');
        return r.body;
      },
      openApk: (release) async {
        final raw = release.apk;
        final uri = raw.startsWith('http') ? Uri.parse(raw) : aliasApkUrl();
        final r = await inner.send(http.Request('GET', uri)).timeout(const Duration(minutes: 10));
        if (r.statusCode != 200) throw http.ClientException('status ${r.statusCode}');
        final len = r.contentLength;
        return (stream: r.stream, contentLength: len != null && len > 0 ? len : null);
      },
      cacheDirPath: () async => (await getTemporaryDirectory()).path,
    );
  }

  final MetaFetcher fetchMeta;
  final ApkOpener openApk;
  final Future<String> Function() cacheDirPath;

  /// Null on any problem (bad body, offline) — the caller reads that as
  /// "no update, stay silent". Never throws.
  Future<UpdateRelease?> fetchLatest() async {
    try {
      return UpdateRelease.tryParse(await fetchMeta());
    } catch (_) {
      return null;
    }
  }

  /// Downloads to `<cacheDir>/ccferry-update.apk`, hashing on the fly.
  /// Returns the file path after the digest matches [release.sha256];
  /// on mismatch the file is deleted and [UpdateVerifyException] thrown.
  /// [idleTimeout] bounds the silence between body chunks — a stalled
  /// connection fails into the retry path instead of hanging the caller.
  Future<String> downloadApk(
    UpdateRelease release, {
    void Function(double progress)? onProgress,
    Duration idleTimeout = const Duration(seconds: 30),
  }) async {
    final dir = await cacheDirPath();
    final file = File('$dir/ccferry-update.apk');
    final (:stream, :contentLength) = await openApk(release);

    late Digest digest;
    final hasher = sha256.startChunkedConversion(
      ChunkedConversionSink<Digest>.withCallback((d) => digest = d.single),
    );
    final sink = file.openWrite();
    try {
      var received = 0;
      await for (final chunk in stream.timeout(idleTimeout)) {
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

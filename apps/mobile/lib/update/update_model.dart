import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/update/update_release.dart';
import 'package:ccferry_mobile/update/update_service.dart';

enum UpdatePhase { idle, checking, upToDate, available, downloading, ready, failed }

/// Phase machine for the in-app updater (spec section 5). `failed` after a
/// check is silent by convention — the UI renders nothing for it; `failed`
/// after a download is surfaced with [error] and retried via download().
class UpdateModel extends ChangeNotifier {
  UpdateModel({
    required this.service,
    required this.localVersion,
  });

  final UpdateService service;
  final Future<(int, String)> Function() localVersion;

  UpdatePhase _phase = UpdatePhase.idle;
  UpdateRelease? release;
  double _progress = 0;
  String? _error;
  String? _downloadedApkPath;
  bool _dismissed = false;
  String _localLabel = '';

  UpdatePhase get phase => _phase;
  double get progress => _progress;
  String? get error => _error;
  String? get downloadedApkPath => _downloadedApkPath;
  bool get dismissed => _dismissed;
  String get localLabel => _localLabel;

  Future<void> check() async {
    if (_phase == UpdatePhase.downloading || _phase == UpdatePhase.ready) return;
    _dismissed = false;
    _phase = UpdatePhase.checking;
    notifyListeners();

    final (code, name) = await localVersion();
    _localLabel = name;
    final r = await service.fetchLatest();
    if (r == null) {
      _phase = UpdatePhase.failed; // silent: no UI for a failed check
    } else if (r.versionCode > code) {
      release = r;
      _phase = UpdatePhase.available;
    } else {
      _phase = UpdatePhase.upToDate;
    }
    notifyListeners();
  }

  Future<void> download({void Function(double progress)? onProgress}) async {
    final r = release;
    if (r == null ||
        (_phase != UpdatePhase.available && _phase != UpdatePhase.failed)) {
      return;
    }
    _phase = UpdatePhase.downloading;
    _progress = 0;
    _error = null;
    notifyListeners();
    try {
      _downloadedApkPath = await service.downloadApk(
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

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

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

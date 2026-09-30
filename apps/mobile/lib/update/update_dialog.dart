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
      // The dialog builds on the root navigator, ABOVE the page's provider
      // scope (same shape as the /settings route) — provide the model
      // directly or every watch/read inside throws in release builds.
      builder: (_) => ChangeNotifierProvider<UpdateModel>.value(
        value: update,
        child: const UpdateDialog(),
      ),
    );
  }

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  final UpdateInstaller _installer = UpdateInstaller();
  bool _autoInstallFired = false;
  bool _needPermission = false;

  Future<void> _install() async {
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

    final title = release == null
        ? const Text('发现新版本')
        : Text('发现新版本 ${release.version}（当前 ${update.localLabel}）');

    Widget content = Text(release?.notes ?? '');
    var actions = <Widget>[
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

    const checkable = [UpdatePhase.available, UpdatePhase.idle, UpdatePhase.checking];
    if (checkable.contains(update.phase)) {
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
          onPressed: () => _install(),
          child: const Text('立即安装'),
        ),
      ];
    }

    return AlertDialog(title: title, content: content, actions: actions);
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/state/auth_model.dart';

// Runtime reconfiguration (the pwa Settings page, thin): the tunnel endpoint
// and token, prefilled with the current values. Saving writes through
// AuthModel — ApiClient reads base/token through closures, so existing
// models pick the new values up on their next request, no rebuild needed.
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _base = TextEditingController();
  final _token = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthModel>();
    _base.text = auth.base ?? '';
    _token.text = auth.token ?? '';
  }

  Future<void> _save() async {
    final base = _base.text.trim();
    final token = _token.text.trim();
    if (base.isEmpty || token.isEmpty) {
      setState(() => _error = '请填写隧道地址和访问令牌');
      return;
    }
    await context.read<AuthModel>().save(daemonBase: base, accessToken: token);
    if (!mounted) return;
    if (Navigator.canPop(context)) Navigator.pop(context);
  }

  @override
  void dispose() {
    _base.dispose();
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const Key('field-base'),
              controller: _base,
              decoration: const InputDecoration(
                labelText: '隧道地址',
                hintText: 'https://your-tunnel.example',
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('field-token'),
              controller: _token,
              decoration: const InputDecoration(labelText: '访问令牌'),
              obscureText: true,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _save, child: const Text('保存')),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import 'package:ccferry_mobile/state/auth_model.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.model, required this.onDone});

  final AuthModel model;
  final VoidCallback onDone;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _base = TextEditingController();
  final _token = TextEditingController();
  String? _error;

  Future<void> _save() async {
    final base = _base.text.trim();
    final token = _token.text.trim();
    if (base.isEmpty || token.isEmpty) {
      setState(() => _error = '请填写隧道地址和访问令牌');
      return;
    }
    await widget.model.save(daemonBase: base, accessToken: token);
    widget.onDone();
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
      appBar: AppBar(title: const Text('登录 ccferry')),
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

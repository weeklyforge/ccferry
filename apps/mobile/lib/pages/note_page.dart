import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/vault/vault_model.dart';
import 'package:ccferry_mobile/widgets/markdown_body.dart';

class NotePage extends StatefulWidget {
  const NotePage({super.key, required this.path});

  final String path;

  @override
  State<NotePage> createState() => _NotePageState();
}

class _NotePageState extends State<NotePage> {
  String? _content;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() {
      _content = null;
      _error = null;
    });
    try {
      final content = await context.read<VaultModel>().readNote(widget.path);
      if (mounted) setState(() => _content = content);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.path.split('/').last)),
      body: _content != null
          ? SingleChildScrollView(
              padding: const EdgeInsets.all(12),
              child: MarkdownBody(text: _content!),
            )
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('加载失败'),
                      TextButton(onPressed: _load, child: const Text('重试')),
                    ],
                  ),
                )
              : const Center(child: CircularProgressIndicator()),
    );
  }
}

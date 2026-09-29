import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/session/bubbles.dart';
import 'package:ccferry_mobile/session/sender.dart';
import 'package:ccferry_mobile/session/stream_model.dart';
import 'package:ccferry_mobile/widgets/bubble_view.dart';

class SessionPage extends StatefulWidget {
  const SessionPage({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<SessionPage> createState() => _SessionPageState();
}

class _SessionPageState extends State<SessionPage> {
  final ScrollController _scroll = ScrollController();
  final TextEditingController _input = TextEditingController();
  SessionSender? _sender;

  @override
  void initState() {
    super.initState();
    // start() notifies listeners — defer it out of the build phase.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<SessionStreamModel>().start(sessionId: widget.sessionId);
      setState(() {
        _sender = SessionSender(
          client: context.read<ApiClient>(),
          sessionId: widget.sessionId,
        );
      });
    });
  }

  Future<void> _send() async {
    final sender = _sender;
    if (sender == null) return;
    final text = _input.text;
    await sender.send(
      text,
      confirmForce: () async {
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            content: const Text('会话近期仍有写入（可能本地 TUI 正在跑）。强制续聊？'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('强制续聊')),
            ],
          ),
        );
        if (ok == true) _input.clear();
        return ok == true;
      },
    );
    if (sender.errors.isNotEmpty && mounted) {
      setState(() {}); // surface collected error lines below the composer
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final model = context.watch<SessionStreamModel>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('会话')),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(12),
              itemCount: model.bubbles.length + (model.fullHistory ? 0 : 1),
              itemBuilder: (context, i) {
                if (i == model.bubbles.length) {
                  return TextButton(
                    onPressed: model.loadFullHistory,
                    child: const Text('加载全部历史'),
                  );
                }
                final bubble = model.bubbles[i];
                final id = bubble is ToolBubble ? bubble.toolUseId : null;
                final result = id == null ? null : model.toolResults[id];
                return BubbleView(
                  bubble: bubble,
                  hasResult: result != null,
                  resultText: result?.text,
                  resultError: result?.isError ?? false,
                  expanded: id != null && model.expanded.contains(id),
                  onToggleTool: id == null ? null : () => model.toggle(id),
                  markdown: bubble is TextBubble && bubble.role == 'assistant',
                );
              },
            ),
          ),
          if (_sender != null && _sender!.errors.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _sender!.errors.last,
                  style: const TextStyle(color: Colors.red, fontSize: 12),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      hintText: '续聊…',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _send, child: const Text('发送')),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

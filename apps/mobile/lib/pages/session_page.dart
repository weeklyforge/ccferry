import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/session/bubbles.dart';
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

  @override
  void initState() {
    super.initState();
    // start() notifies listeners — defer it out of the build phase.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<SessionStreamModel>().start(sessionId: widget.sessionId);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
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
                );
              },
            ),
          ),
          // Composer lands in Task 10.
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';

import 'package:ccferry_mobile/session/bubbles.dart';

// One chat bubble. Assistant text stays plain in this widget — the session
// page swaps in the markdown body (Task 10); user/tool/raw are never parsed.
class BubbleView extends StatelessWidget {
  const BubbleView({
    super.key,
    required this.bubble,
    required this.resultText,
    required this.resultError,
    required this.hasResult,
    required this.expanded,
    required this.onToggleTool,
  });

  final Bubble bubble;
  final bool hasResult;
  final String? resultText;
  final bool resultError;
  final bool expanded;
  final VoidCallback? onToggleTool;

  @override
  Widget build(BuildContext context) {
    final bubble = this.bubble;
    if (bubble is TextBubble) {
      return Align(
        alignment: bubble.role == 'user' ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
          decoration: BoxDecoration(
            color: bubble.role == 'user' ? Colors.blue : const Color(0xFFF2F3F5),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            bubble.text,
            style: TextStyle(color: bubble.role == 'user' ? Colors.white : Colors.black87),
          ),
        ),
      );
    }
    if (bubble is ToolBubble) {
      final status = !hasResult
          ? '⏳'
          : resultError
              ? '✖'
              : '✔';
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBE8),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: onToggleTool,
              child: Row(
                children: [
                  Text(status),
                  const SizedBox(width: 6),
                  Text(bubble.name,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      bubble.summary,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: Colors.grey[700]),
                    ),
                  ),
                  if (bubble.ts != null)
                    Text(bubble.ts!, style: TextStyle(fontSize: 10, color: Colors.grey)),
                ],
              ),
            ),
            if (expanded)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.only(top: 6),
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: Colors.black12)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(resultError ? '结果（失败）' : '结果',
                        style: TextStyle(fontSize: 11, color: Colors.grey[700])),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 240),
                      child: SingleChildScrollView(
                        child: SelectableText(
                          hasResult ? (resultText?.isEmpty == true ? '（无输出）' : resultText!) : '⏳ 执行中…',
                          style: const TextStyle(fontSize: 11),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
    }
    final raw = (bubble as RawBubble).text;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFFF7F7F7),
          borderRadius: BorderRadius.circular(8),
        ),
        child: SelectableText(raw, style: TextStyle(fontSize: 12, color: Colors.grey[600])),
      ),
    );
  }
}

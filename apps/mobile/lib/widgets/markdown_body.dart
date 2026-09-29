import 'package:flutter/material.dart';
import 'package:markdown_widget/markdown_widget.dart';

// Assistant-bubble markdown rendering (spec R1): markdown_widget is the
// community-maintained renderer chosen over the discontinued flutter_markdown.
// HTML inside the source is escaped by the renderer, never interpreted —
// session transcripts can quote arbitrary markup.
class MarkdownBody extends StatelessWidget {
  const MarkdownBody({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return MarkdownBlock(data: text, config: MarkdownConfig.defaultConfig);
  }
}

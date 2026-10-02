import 'package:flutter/material.dart';
import 'package:markdown_widget/markdown_widget.dart';

// Assistant-bubble markdown rendering (spec R1): markdown_widget is the
// community-maintained renderer chosen over the discontinued flutter_markdown.
// HTML inside the source is escaped by the renderer, never interpreted —
// session transcripts can quote arbitrary markup.
//
// Tables render through TableConfig.wrapper: a wide table's intrinsic width
// overflows the bubble and the WidgetSpan clips it silently, so the wrapper
// puts every table in a horizontal scroll view instead (narrow tables are
// unaffected; vertical scrolling stays with the outer list, no gesture clash).
class MarkdownBody extends StatelessWidget {
  const MarkdownBody({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return MarkdownBlock(
      data: text,
      config: MarkdownConfig(configs: [
        TableConfig(
          wrapper: (table) => SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: table,
          ),
        ),
      ]),
    );
  }
}

// SSE framing for the tunnel streams: frames are separated by a blank line
// (\n\n) and payloads ride `data: ` lines — the exact wire shape the PWA's
// readSsePost consumes. Chunk boundaries may land mid-frame; the splitter
// buffers until a frame completes.
class SseFrameSplitter {
  final StringBuffer _buffer = StringBuffer();

  /// Feeds one decoded chunk; returns the payloads of frames completed by it.
  List<String> add(String chunk) {
    _buffer.write(chunk);
    final out = <String>[];
    var text = _buffer.toString();
    for (;;) {
      final boundary = text.indexOf('\n\n');
      if (boundary < 0) break;
      final frame = text.substring(0, boundary);
      text = text.substring(boundary + 2);
      final data = <String>[];
      for (final line in frame.split('\n')) {
        if (line.startsWith('data: ')) data.add(line.substring(6));
      }
      out.add(data.join('\n'));
    }
    _buffer
      ..clear()
      ..write(text);
    return out;
  }
}

Stream<String> parseSse(Stream<String> chunks) async* {
  final splitter = SseFrameSplitter();
  await for (final chunk in chunks) {
    for (final payload in splitter.add(chunk)) {
      yield payload;
    }
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/net/sse.dart';

void main() {
  test('splits complete frames and buffers partials', () {
    final s = SseFrameSplitter();
    // The first frame already terminates inside chunk 1 (its \n\n is there);
    // only the trailing 'da' is buffered.
    expect(s.add('data: a\n\nda'), ['a']);
    expect(s.add('ta: b\n\ndata: c\n\n'), ['b', 'c']);
  });

  test('buffers chunks split mid data-line', () async {
    final out = await parseSse(
      Stream.fromIterable(['data: 1\n\ndata:', ' 2\n\n']),
    ).toList();
    // 'data:' + ' 2' rejoins into one data line, prefix stripped → '2'.
    expect(out, ['1', '2']);
  });

  test('ignores non-data lines inside frames', () async {
    final out = await parseSse(
      Stream.fromIterable(['event: message\ndata: x\n\n']),
    ).toList();
    expect(out, ['x']);
  });
}

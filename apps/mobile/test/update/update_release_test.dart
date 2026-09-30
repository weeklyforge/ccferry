import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/update/update_release.dart';

void main() {
  test('parses a full metadata document', () {
    final r = UpdateRelease.tryParse(
        '{"version":"1.0.1","versionCode":2,"sha256":"abc","apk":"ccferry.apk","notes":"- a"}');
    expect(r, isNotNull);
    expect(r!.version, '1.0.1');
    expect(r.versionCode, 2);
    expect(r.sha256, 'abc');
    expect(r.apk, 'ccferry.apk');
    expect(r.notes, '- a');
  });

  test('notes are optional and default to empty', () {
    final r = UpdateRelease.tryParse(
        '{"version":"1.0.1","versionCode":2,"sha256":"abc","apk":"ccferry.apk"}');
    expect(r!.notes, '');
  });

  test('non-json garbage (error page, captive portal) yields null', () {
    expect(UpdateRelease.tryParse('<html>502 Bad Gateway</html>'), isNull);
  });

  test('missing required fields yield null', () {
    expect(UpdateRelease.tryParse('{"version":"1.0.1","sha256":"a","apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"versionCode":2,"sha256":"a","apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"version":"1.0.1","versionCode":2,"apk":"x"}'), isNull);
    expect(UpdateRelease.tryParse('{"version":"1.0.1","versionCode":2,"sha256":"a"}'), isNull);
  });

  test('a non-integer versionCode yields null (tolerant of 2.0 writes)', () {
    expect(
        UpdateRelease.tryParse(
            '{"version":"1.0.1","versionCode":2.0,"sha256":"a","apk":"x"}'),
        isNull);
  });

  test('a json array or scalar yields null', () {
    expect(UpdateRelease.tryParse('[1,2]'), isNull);
    expect(UpdateRelease.tryParse('"ok"'), isNull);
  });
}

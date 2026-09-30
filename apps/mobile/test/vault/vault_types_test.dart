import 'package:flutter_test/flutter_test.dart';
import 'package:ccferry_mobile/vault/vault_types.dart';

void main() {
  test('parses a dir with children and a file with size', () {
    final node = VaultNode.tryFromJson(const {
      'name': '项目管理',
      'path': '项目管理',
      'kind': 'dir',
      'children': [
        {'name': '索引.md', 'path': '项目管理/索引.md', 'kind': 'file', 'sizeBytes': 12},
      ],
    });
    expect(node, isNotNull);
    expect(node!.kind, 'dir');
    expect(node.sizeBytes, isNull);
    expect(node.children.single.name, '索引.md');
    expect(node.children.single.sizeBytes, 12);
  });

  test('drops malformed nodes and tolerates missing children', () {
    expect(VaultNode.tryFromJson(const {'path': 'x', 'kind': 'file'}), isNull);
    expect(VaultNode.tryFromJson(const {'name': 'x', 'path': 'x', 'kind': 'symlink'}), isNull);
    final bare = VaultNode.tryFromJson(const {'name': 'x', 'path': 'x', 'kind': 'dir'});
    expect(bare!.children, isEmpty);
  });

  test('filters null children out of a mixed list', () {
    final node = VaultNode.tryFromJson(const {
      'name': 'd',
      'path': 'd',
      'kind': 'dir',
      'children': [
        {'name': 'ok.md', 'path': 'd/ok.md', 'kind': 'file'},
        {'kind': 'file'},
      ],
    });
    expect(node!.children.single.name, 'ok.md');
  });

  test('parses a search match', () {
    final m = VaultSearchMatch.fromJson(const {'path': 'a/b.md', 'line': 3, 'text': 'needle here'});
    expect(m.path, 'a/b.md');
    expect(m.line, 3);
    expect(m.text, 'needle here');
  });
}

// Wire types of the daemon vault service (M2 /api/vault/*), mirrored in Dart.
// The tree may contain junk rows; a malformed node is dropped, never fatal.

class VaultNode {
  const VaultNode({
    required this.name,
    required this.path,
    required this.kind,
    this.sizeBytes,
    this.children = const [],
  });

  static VaultNode? tryFromJson(Map<String, dynamic> j) {
    final name = j['name'];
    final path = j['path'];
    final kind = j['kind'];
    if (name is! String || path is! String || (kind != 'file' && kind != 'dir')) {
      return null;
    }
    final rawChildren = j['children'];
    final children = rawChildren is List
        ? [
            for (final c in rawChildren)
              if (c is Map<String, dynamic>) ...[
                ?tryFromJson(c),
              ],
          ]
        : const <VaultNode>[];
    return VaultNode(
      name: name,
      path: path,
      kind: kind as String,
      sizeBytes: (j['sizeBytes'] as num?)?.toInt(),
      children: children,
    );
  }

  final String name, path, kind;
  final int? sizeBytes;
  final List<VaultNode> children;
}

class VaultSearchMatch {
  const VaultSearchMatch({required this.path, required this.line, required this.text});

  factory VaultSearchMatch.fromJson(Map<String, dynamic> j) => VaultSearchMatch(
        path: j['path'] as String,
        line: (j['line'] as num).toInt(),
        text: j['text'] as String? ?? '',
      );

  final String path, text;
  final int line;
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/vault/vault_model.dart';
import 'package:ccferry_mobile/vault/vault_types.dart';

class VaultPage extends StatefulWidget {
  const VaultPage({super.key});

  @override
  State<VaultPage> createState() => _VaultPageState();
}

class _VaultPageState extends State<VaultPage> {
  final List<String> _stack = [];
  final TextEditingController _query = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Refresh on every entry (spec D4); an old tree stays visible meanwhile.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<VaultModel>().refresh();
    });
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _drill(String segment) => setState(() => _stack.add(segment));

  void _up() {
    if (_stack.isNotEmpty) setState(() => _stack.removeLast());
  }

  List<VaultNode> _childrenOf(List<VaultNode> tree) {
    var level = tree;
    for (final segment in _stack) {
      VaultNode? dir;
      for (final n in level) {
        if (n.kind == 'dir' && n.name == segment) {
          dir = n;
          break;
        }
      }
      if (dir == null) return const [];
      level = dir.children;
    }
    final dirs = level.where((n) => n.kind == 'dir').toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    final files = level.where((n) => n.kind == 'file').toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    return [...dirs, ...files]; // dirs first (spec D6)
  }

  @override
  Widget build(BuildContext context) {
    final vault = context.watch<VaultModel>();
    return PopScope(
      canPop: _stack.isEmpty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _up();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_stack.isEmpty ? '知识库' : _stack.last),
          leading: _stack.isEmpty ? null : BackButton(onPressed: _up),
        ),
        body: _body(vault),
      ),
    );
  }

  Widget _body(VaultModel vault) {
    if (vault.phase == VaultPhase.notConfigured) {
      return const Center(child: Text('知识库未配置'));
    }
    if (vault.phase == VaultPhase.failed && vault.tree.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('加载失败'),
            TextButton(onPressed: vault.refresh, child: const Text('重试')),
          ],
        ),
      );
    }
    if (vault.phase == VaultPhase.loading && vault.tree.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            controller: _query,
            decoration: const InputDecoration(
              hintText: '搜索知识库',
              prefixIcon: Icon(Icons.search),
              isDense: true,
            ),
            onChanged: vault.search,
          ),
        ),
        Expanded(child: vault.query.trim().isEmpty ? _browseList(vault) : _searchList(vault)),
      ],
    );
  }

  Widget _browseList(VaultModel vault) {
    final children = _childrenOf(vault.tree);
    return RefreshIndicator(
      onRefresh: vault.refresh,
      child: ListView.builder(
        // Always scrollable so pull-to-refresh works on short levels too.
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: children.length,
        itemBuilder: (ctx, i) {
          final n = children[i];
          if (n.kind == 'dir') {
            return ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: Text(n.name),
              onTap: () => _drill(n.name),
            );
          }
          return ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(n.name),
            onTap: () => Navigator.of(ctx).pushNamed('/note', arguments: n.path),
          );
        },
      ),
    );
  }

  Widget _searchList(VaultModel vault) {
    if (vault.searching && vault.matches.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (vault.searchFailed) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('搜索失败'),
            TextButton(
              onPressed: () => vault.search(vault.query),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }
    if (vault.matches.isEmpty) return const Center(child: Text('无匹配结果'));
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: vault.matches.length,
      itemBuilder: (ctx, i) {
        final m = vault.matches[i];
        return ListTile(
          title: Text(m.text),
          subtitle: Text(m.path),
          onTap: () => Navigator.of(ctx).pushNamed('/note', arguments: m.path),
        );
      },
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/net/follow.dart';
import 'package:ccferry_mobile/session/session_status.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/state/auth_model.dart';
import 'package:ccferry_mobile/state/sessions_model.dart';

String _relative(int ms, DateTime now) {
  final minutes = ((now.millisecondsSinceEpoch - ms) / 60000).round();
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return '$minutes 分钟前';
  return '${(minutes / 60).round()} 小时前';
}

class SessionsPage extends StatefulWidget {
  const SessionsPage({super.key});

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  Timer? _poll;
  FollowHandle? _eventsHandle;
  // PWA Collapse semantics: every project group starts collapsed; tapping a
  // header toggles it (openGroups in the pwa starts empty).
  final Set<String> _openGroups = {};

  @override
  void initState() {
    super.initState();
    // Stale-while-revalidate like the pwa overview: refresh now, poll while
    // the page stays visible.
    context.read<SessionsModel>().refresh();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) context.read<SessionsModel>().refresh();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _listenEvents();
    });
  }

  // The events stream does two jobs: instant list refresh on session events,
  // and — just by being open — it marks this clientId foreground on the
  // cloud, which is what suppresses duplicate native pushes.
  void _listenEvents() {
    final client = context.read<ApiClient>();
    final clientId = context.read<AuthModel>().clientId;
    final model = context.read<SessionsModel>();
    _eventsHandle = followSse(
      connect: () => client.sseGet('/api/events/stream?clientId=${Uri.encodeQueryComponent(clientId ?? '')}'),
      onLine: (_) => model.refresh(),
      onReset: () {},
      delay: (d) => Future<void>.delayed(d),
    );
  }

  @override
  void dispose() {
    _poll?.cancel();
    _eventsHandle?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sessions = context.watch<SessionsModel>();
    final approvals = context.watch<ApprovalsModel>();
    final now = DateTime.now();

    Widget body;
    if (sessions.unauthorized) {
      body = const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('尚未授权：先到登录页保存访问令牌，即可在这里查看所有会话'),
        ),
      );
    } else if (sessions.loading && sessions.sessions.isEmpty) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = RefreshIndicator(
        onRefresh: sessions.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            for (final group in sessions.groups) ...[
              InkWell(
                onTap: () => setState(() {
                  if (!_openGroups.remove(group.projectPath)) {
                    _openGroups.add(group.projectPath);
                  }
                }),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(group.shortName,
                                style: const TextStyle(
                                    fontSize: 14, fontWeight: FontWeight.w600)),
                            Text(group.projectPath,
                                style: TextStyle(
                                    fontSize: 11, color: Colors.grey[600])),
                          ],
                        ),
                      ),
                      Text('${group.list.length}',
                          style:
                              TextStyle(fontSize: 12, color: Colors.grey[600])),
                      Icon(_openGroups.contains(group.projectPath)
                          ? Icons.expand_less
                          : Icons.expand_more),
                    ],
                  ),
                ),
              ),
              if (_openGroups.contains(group.projectPath))
                for (final s in group.list)
                  ListTile(
                    title: Text(s.firstUserText.isEmpty ? '(无摘要)' : s.firstUserText),
                    subtitle: Text(_relative(s.lastModifiedMs, now)),
                    trailing: _statusChip(sessionStatus(s, now, approvals.pending)),
                    onTap: () => Navigator.of(context)
                        .pushNamed('/session', arguments: s.sessionId),
                  ),
            ],
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('会话总览')),
      body: body,
    );
  }

  Widget _statusChip(String status) {
    switch (status) {
      case 'awaiting':
        return Chip(
          label: const Text('等你批准', style: TextStyle(fontSize: 11, color: Colors.white)),
          backgroundColor: Colors.red,
          visualDensity: VisualDensity.compact,
        );
      case 'running':
        return Chip(
          label: const Text('进行中', style: TextStyle(fontSize: 11, color: Colors.white)),
          backgroundColor: Colors.blue,
          visualDensity: VisualDensity.compact,
        );
      default:
        return Chip(
          label: const Text('空闲', style: TextStyle(fontSize: 11)),
          visualDensity: VisualDensity.compact,
        );
    }
  }
}

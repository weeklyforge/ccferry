import 'dart:async';

import 'package:flutter/material.dart';
import 'package:http/io_client.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/login_page.dart';
import 'package:ccferry_mobile/pages/session_page.dart';
import 'package:ccferry_mobile/pages/sessions_page.dart';
import 'package:ccferry_mobile/push/push_service.dart';
import 'package:ccferry_mobile/session/stream_model.dart';
import 'package:ccferry_mobile/state/approvals_model.dart';
import 'package:ccferry_mobile/state/auth_model.dart';
import 'package:ccferry_mobile/state/secure_store.dart';
import 'package:ccferry_mobile/state/sessions_model.dart';

void main() {
  runApp(const CcferryApp());
}

// App shell: boots the auth store, then either the login page or the session
// overview. Route table: /login, /sessions, /session (args: sessionId).
class CcferryApp extends StatefulWidget {
  const CcferryApp({super.key, this.auth});

  final AuthModel? auth; // injectable for tests

  @override
  State<CcferryApp> createState() => _CcferryAppState();
}

class _CcferryAppState extends State<CcferryApp> {
  late final AuthModel _auth = widget.auth ?? AuthModel(store: const SecureTokenStore());
  final GlobalKey<NavigatorState> _navKey = GlobalKey<NavigatorState>();
  ApiClient? _client;
  ApprovalsModel? _approvals;
  SessionsModel? _sessions;
  PushService? _push;
  bool _booted = false;
  bool _pushBooted = false;

  @override
  void initState() {
    super.initState();
    // A missing platform channel (tests, or a broken secure storage plugin)
    // must not brick the boot — the fields stay null and the login page shows.
    _auth.bootstrap().catchError((Object _) {}).then((_) => mounted ? setState(() => _booted = true) : null);
  }

  void _ensureModels() {
    if (_client != null || !_auth.ready) return;
    _client = ApiClient(
      client: IOClient(),
      base: () => Uri.parse(_auth.base!),
      token: () => _auth.token,
    );
    _approvals = ApprovalsModel(client: _client!);
    _sessions = SessionsModel(client: _client!, approvals: _approvals!);
    _push = PushService(client: _client!, clientId: _auth.clientId!);
  }

  // Push registration + notification-tap routing. Fire-and-forget: a failed
  // registration never blocks the UI.
  Future<void> _bootPush() async {
    if (_pushBooted || _push == null) return;
    _pushBooted = true;
    _push!.onTap((sessionId) {
      _navKey.currentState?.pushNamed('/session', arguments: sessionId);
    });
    try {
      await _push!.bootstrap();
    } catch (_) {
      _pushBooted = false; // retry on next boot trigger
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navKey,
      title: 'ccferry',
      routes: {'/sessions': (ctx) => _sessionsHome()},
      onGenerateRoute: (settings) {
        if (settings.name == '/session') {
          final sessionId = settings.arguments as String;
          return MaterialPageRoute<void>(
            settings: settings,
            builder: (ctx) => MultiProvider(
              providers: [
                Provider<ApiClient>.value(value: _client!),
                ChangeNotifierProvider<ApprovalsModel>.value(value: _approvals!),
                ChangeNotifierProvider<SessionStreamModel>(
                  create: (_) => SessionStreamModel(connect: _client!.sseGet),
                ),
              ],
              child: SessionPage(sessionId: sessionId),
            ),
          );
        }
        return null;
      },
      home: !_booted
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _auth.ready
              ? _sessionsHome()
              : LoginPage(
                  model: _auth,
                  onDone: () => setState(_ensureModels),
                ),
    );
  }

  Widget _sessionsHome() {
    _ensureModels();
    if (_sessions == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    unawaited(_bootPush());
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthModel>.value(value: _auth),
        Provider<ApiClient>.value(value: _client!),
        ChangeNotifierProvider<ApprovalsModel>.value(value: _approvals!),
        ChangeNotifierProvider<SessionsModel>.value(value: _sessions!),
      ],
      child: const SessionsPage(),
    );
  }
}

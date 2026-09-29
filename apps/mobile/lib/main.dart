import 'package:flutter/material.dart';
import 'package:http/io_client.dart';
import 'package:provider/provider.dart';

import 'package:ccferry_mobile/net/api_client.dart';
import 'package:ccferry_mobile/pages/login_page.dart';
import 'package:ccferry_mobile/pages/sessions_page.dart';
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
  ApiClient? _client;
  ApprovalsModel? _approvals;
  SessionsModel? _sessions;
  bool _booted = false;

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
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ccferry',
      routes: {'/login': (ctx) => _loginRoute(ctx), '/sessions': (ctx) => _sessionsRoute(ctx)},
      onGenerateRoute: (settings) {
        if (settings.name == '/session') {
          return MaterialPageRoute<void>(
            settings: settings,
            builder: (ctx) => const SizedBox(), // session page lands in Task 9
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

  Widget _loginRoute(BuildContext ctx) =>
      LoginPage(model: _auth, onDone: () => setState(_ensureModels));

  Widget _sessionsRoute(BuildContext ctx) => _sessionsHome();

  Widget _sessionsHome() {
    _ensureModels();
    if (_sessions == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthModel>.value(value: _auth),
        ChangeNotifierProvider<ApprovalsModel>.value(value: _approvals!),
        ChangeNotifierProvider<SessionsModel>.value(value: _sessions!),
      ],
      child: const SessionsPage(),
    );
  }
}

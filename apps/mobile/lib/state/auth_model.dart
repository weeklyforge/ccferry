import 'dart:math';

import 'package:flutter/foundation.dart';

import 'package:ccferry_mobile/state/secure_store.dart';

// Login state: tunnel base URL + token, persisted through SecureStore.
// clientId is a stable per-install id — the cloud keys its foreground
// suppression map on it, so it must survive restarts.
class AuthModel extends ChangeNotifier {
  AuthModel({required this.store});

  final SecureStore store;

  String? base;
  String? token;
  String? clientId;

  bool get ready => base != null && token != null;

  Future<void> bootstrap() async {
    base ??= await store.read('daemonBase');
    token ??= await store.read('token');
    if (clientId == null) {
      clientId = await store.read('clientId');
      clientId ??= _newClientId();
      await store.write('clientId', clientId!);
    }
    notifyListeners();
  }

  Future<void> save({required String daemonBase, required String accessToken}) async {
    base = daemonBase;
    token = accessToken;
    if (clientId == null) {
      clientId = await store.read('clientId');
      clientId ??= _newClientId();
    }
    await store.write('daemonBase', daemonBase);
    await store.write('token', accessToken);
    await store.write('clientId', clientId!);
    notifyListeners();
  }

  Future<void> signOut() async {
    base = null;
    token = null;
    notifyListeners();
  }

  static String _newClientId() {
    final rnd = Random();
    const hex = '0123456789abcdef';
    String chunk(int n) => List.generate(n, (_) => hex[rnd.nextInt(16)]).join();
    return '${chunk(8)}-${chunk(4)}-4${chunk(3)}-${chunk(4)}-${chunk(12)}';
  }
}

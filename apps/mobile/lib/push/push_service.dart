import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'package:ccferry_mobile/net/api_client.dart';

typedef FcmTokenSource = Future<String?> Function();

// Native FCM push (spec §7): register the device token against
// /api/push/native/subscribe and route notification taps to the session
// page. The real Firebase calls sit behind seams so the registration and
// routing logic stays unit-testable (and runnable on a machine without
// Firebase config files).
class PushService {
  PushService({
    required this.client,
    required this.clientId,
    String? platform,
    this.getToken,
  }) : _platformName = platform;

  final ApiClient client;
  final String clientId;
  final String? _platformName;
  final FcmTokenSource? getToken;

  bool subscribed = false;
  bool _firebaseReady = false;
  String? _lastToken;
  final List<void Function(String sessionId)> _tapHandlers = [];

  /// Real token source; overridden in tests.
  Future<String?> defaultGetToken() => FirebaseMessaging.instance.getToken();

  String get platform {
    if (_platformName != null) return _platformName;
    final os = Platform.operatingSystem;
    return os == 'ios' || os == 'android' ? os : 'android';
  }

  /// Initializes Firebase (no-op failure when config files are absent) and
  /// (re)posts the subscription — a rotated token upserts on next start.
  Future<void> bootstrap() async {
    if (getToken == null) {
      // Real path only: a missing Firebase config must disable push without
      // touching the rest of the app. Tests inject a token source and skip
      // Firebase entirely.
      try {
        if (Firebase.apps.isEmpty) await Firebase.initializeApp();
        _firebaseReady = true;
      } catch (_) {
        return;
      }
    }
    final token = await (getToken ?? defaultGetToken)();
    if (token == null) return;
    if (subscribed && token == _lastToken) return;
    await client.postJson('/api/push/native/subscribe', {
      'clientId': clientId,
      'platform': platform,
      'fcmToken': token,
    });
    _lastToken = token;
    subscribed = true;
  }

  /// Registers the tap handler; the FCM entry points call [handleTap] for
  /// both cold start (getInitialMessage) and warm taps (onMessageOpenedApp).
  void onTap(void Function(String sessionId) go) {
    _tapHandlers.add(go);
    if (!_firebaseReady) return; // test seam or push-less build — nothing to wire
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) _dispatch(message.data);
    });
    FirebaseMessaging.onMessageOpenedApp.listen((message) => _dispatch(message.data));
  }

  void _dispatch(Map<String, dynamic> data) {
    final sessionId = data['sessionId'];
    if (sessionId is String) {
      for (final handler in _tapHandlers) {
        handler(sessionId);
      }
    }
  }

  /// Test seam mirroring what the FCM listeners deliver.
  void handleTap(Map<String, dynamic> data) => _dispatch(data);
}

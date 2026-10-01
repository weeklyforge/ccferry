import 'package:flutter/foundation.dart';

// The overview badge combines two independent signals:
// - the SSE transport lifecycle against the cloud: 'connecting' until the
//   stream first opens, 'reconnecting' during backoff after a drop
// - authoritative tunnel-state events the cloud pushes over that stream:
//   'clientOffline' means the cloud is reachable but the PC daemon side of
//   the tunnel is down (crash, power loss, network cut)
class ConnectionModel extends ChangeNotifier {
  String _state = 'connecting';
  bool? _tunnelUp; // null until the first tunnel-state event arrives
  String get state => _state;

  void opened() {
    _state = _tunnelUp == false ? 'clientOffline' : 'online';
    notifyListeners();
  }

  void dropped() {
    _state = 'reconnecting';
    notifyListeners();
  }

  // Tunnel events only arrive while the stream is open, so they cannot
  // overwrite 'connecting'/'reconnecting'.
  void tunnelUp() {
    _tunnelUp = true;
    _state = 'online';
    notifyListeners();
  }

  void tunnelDown() {
    _tunnelUp = false;
    _state = 'clientOffline';
    notifyListeners();
  }
}

import 'package:flutter/foundation.dart';

// Tunnel connectivity as the overview shows it, driven by the events stream
// lifecycle: 'connecting' until the stream first opens, 'online' while it is
// open, 'reconnecting' during backoff after a drop or a failed connect.
class ConnectionModel extends ChangeNotifier {
  String _state = 'connecting';
  String get state => _state;

  void opened() {
    _state = 'online';
    notifyListeners();
  }

  void dropped() {
    _state = 'reconnecting';
    notifyListeners();
  }
}

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// Key-value seam over flutter_secure_storage so models stay unit-testable.
abstract class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class SecureTokenStore implements SecureStore {
  const SecureTokenStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
}

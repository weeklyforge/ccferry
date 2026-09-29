import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:ccferry_mobile/net/sse.dart';

class ApiError implements Exception {
  ApiError(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;

  @override
  String toString() => 'ApiError($status, $body)';
}

// Mirror of the pwa api layer: Bearer on REST and SSE-over-POST, token as a
// query param on SSE GET (EventSource historical semantics the server speaks).
class ApiClient {
  ApiClient({
    required this.client,
    required this.base,
    required this.token,
  });

  final http.Client client;
  final Uri Function() base;
  final String? Function() token;

  Uri _uri(String path) => base().resolve(path);

  Map<String, String> _authHeaders() {
    final t = token();
    return t == null || t.isEmpty ? {} : {'Authorization': 'Bearer $t'};
  }

  Future<http.Response> _get(String path) async {
    final req = http.Request('GET', _uri(path))..headers.addAll(_authHeaders());
    return http.Response.fromStream(await client.send(req));
  }

  /// GETs and decodes a JSON body; throws [ApiError] on non-200.
  Future<dynamic> getJson(String path) async {
    final res = await _get(path);
    return _decodeOrThrow(res);
  }

  /// GETs without parsing — callers that only need the status use this.
  Future<int> getStatus(String path) async => (await _get(path)).statusCode;

  /// SSE GET url with the token query param, for followSse callers.
  Uri sseGetUrl(String path) {
    final url = _uri(path);
    final t = token();
    if (t == null || t.isEmpty) return url;
    return url.replace(queryParameters: {...url.queryParameters, 'token': t});
  }

  /// Opens a GET SSE stream (decoded string chunks) for followSse.
  Future<Stream<String>> sseGet(String path) async {
    final req = http.Request('GET', sseGetUrl(path))..headers.addAll(_authHeaders());
    final res = await client.send(req);
    if (res.statusCode >= 400) {
      final body = await res.stream.bytesToString();
      throw ApiError(res.statusCode, _parseBody(body));
    }
    return res.stream.transform(utf8.decoder);
  }

  /// POSTs JSON and consumes the SSE-over-POST response frames.
  Future<void> ssePost(
    String path,
    Map<String, dynamic> body,
    void Function(String data) onEvent,
  ) async {
    final req = http.Request('POST', _uri(path))
      ..headers.addAll(_authHeaders())
      ..headers['Content-Type'] = 'application/json'
      ..body = jsonEncode(body);
    final res = await client.send(req);
    if (res.statusCode >= 400) {
      final text = await res.stream.bytesToString();
      throw ApiError(res.statusCode, _parseBody(text));
    }
    final splitter = SseFrameSplitter();
    await for (final chunk in res.stream.transform(utf8.decoder)) {
      for (final payload in splitter.add(chunk)) {
        onEvent(payload);
      }
    }
  }

  Future<dynamic> postJson(String path, Map<String, dynamic> body) async {
    final req = http.Request('POST', _uri(path))
      ..headers.addAll(_authHeaders())
      ..headers['Content-Type'] = 'application/json'
      ..body = jsonEncode(body);
    final res = await http.Response.fromStream(await client.send(req));
    return _decodeOrThrow(res);
  }

  dynamic _decodeOrThrow(http.Response res) {
    if (res.statusCode >= 400) throw ApiError(res.statusCode, _parseBody(res.body));
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  Map<String, dynamic> _parseBody(String text) {
    try {
      final value = jsonDecode(text);
      if (value is Map<String, dynamic>) return value;
    } catch (_) {
      // non-JSON error body — keep the empty map
    }
    return {};
  }
}

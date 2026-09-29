// The POST /messages response and the tailed session stream both carry the
// conversation; rendering both duplicates every bubble. The tailed stream
// owns user/assistant rendering — the POST response is only consulted for
// errors (port of pwa lib/post-events.ts).
String? postEventError(Map<String, dynamic> event) {
  if (event['type'] != 'error') return null;
  final message = event['message'];
  return message is String ? message : 'unknown error';
}

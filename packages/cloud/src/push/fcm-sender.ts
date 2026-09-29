import type { FcmSubscription } from './fcm-store';

// firebase-admin flags dead tokens with this code; the subscription must be
// pruned exactly like a web-push 410.
export function isInvalidFcmToken(error: unknown): boolean {
  return (error as { code?: string }).code === 'messaging/registration-token-not-registered';
}

export type FcmSend = (sub: FcmSubscription, payload: string) => Promise<void>;

// FCM `data` entries must ALL be strings (the API rejects booleans/numbers),
// and undefined optionals must be dropped — String(undefined) would leak the
// literal text "undefined" into the notification payload.
export function toFcmData(payload: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

// Real FCM sender built once at boot when FCM_SERVICE_ACCOUNT is set. The
// dynamic imports keep firebase-admin out of the dependency path for
// deployments that never enable native push.
export async function createFcmSender(serviceAccountPath: string): Promise<FcmSend> {
  const appModule = (await import('firebase-admin/app')) as typeof import('firebase-admin/app');
  const messagingModule = (await import('firebase-admin/messaging')) as typeof import('firebase-admin/messaging');
  if (appModule.getApps().length === 0) {
    appModule.initializeApp({ credential: appModule.cert(serviceAccountPath) });
  }
  const messaging = messagingModule.getMessaging();
  return async (sub, payload) => {
    const data = toFcmData(JSON.parse(payload) as Record<string, unknown>);
    await messaging.send({
      token: sub.token,
      notification: { title: data['title'] ?? '', body: data['body'] ?? '' },
      data: data,
    });
  };
}

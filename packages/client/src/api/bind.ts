// Without a token the daemon must never expose itself beyond loopback,
// even if CCFERRY_HOST says otherwise (spec section 5, safety default).
export function computeBindHost(token: string | undefined, hostEnv: string | undefined): string {
  if (!token) return '127.0.0.1';
  return hostEnv ?? '127.0.0.1';
}

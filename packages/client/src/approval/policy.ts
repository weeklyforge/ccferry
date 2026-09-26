import type { ApprovalBroker, PermissionResult } from './broker';

// Unattended default: read-only tools pass, everything else needs remote approval.
export const DEFAULT_TOOL_WHITELIST: readonly string[] = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];

export function evaluateToolPolicy(toolName: string, whitelist: readonly string[]): 'allow' | 'ask' {
  return whitelist.includes(toolName) ? 'allow' : 'ask';
}

// Composes the whole canUseTool decision so the policy/broker/no-broker
// ladder is testable without the SDK: whitelist -> allow; else broker -> its
// verdict; no broker -> deny (fail-closed, matching M1's posture).
export function createCanUseTool(
  whitelist: readonly string[],
  broker?: ApprovalBroker,
  getSessionId: () => string | null = () => null,
): (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult> {
  return async (toolName, input) => {
    if (evaluateToolPolicy(toolName, whitelist) === 'allow') {
      return { behavior: 'allow' };
    }
    if (!broker) {
      return { behavior: 'deny', message: 'Tool use requires remote approval; no approval broker is configured.' };
    }
    return broker.requestApproval({ sessionId: getSessionId(), toolName, input });
  };
}

// Unattended default: read-only tools pass, everything else needs remote approval.
export const DEFAULT_TOOL_WHITELIST: readonly string[] = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];

export function evaluateToolPolicy(toolName: string, whitelist: readonly string[]): 'allow' | 'ask' {
  return whitelist.includes(toolName) ? 'allow' : 'ask';
}

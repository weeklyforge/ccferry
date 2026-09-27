// The overview/history/new-task pages lead with the project NAME; the full
// path is secondary context. Handles both Windows and posix separators and
// ignores trailing separators.
export function shortProject(path: string): string {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
}

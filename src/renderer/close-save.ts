/** True only when every tab is clean after the aggregate close-save pass. */
export function aggregateCloseCanComplete(sessions: Iterable<{ dirty: boolean }>): boolean {
  for (const session of sessions) if (session.dirty) return false
  return true
}

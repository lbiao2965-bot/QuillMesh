/** Return the exact Save-As target that must be detached before an external update. */
export function pendingConflictTarget(pendingSaveTarget: string | null, conflictTarget?: string): string | null {
  return pendingSaveTarget ?? conflictTarget ?? null
}

/**
 * Renderer-safe identity comparison for main-normalized conflict paths. Main
 * owns junction resolution; this keeps equivalent Windows case/separator
 * spellings from clearing a freshly registered authorization for the same
 * disk target.
 */
export function sameConflictTarget(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  const normalize = (value: string): string => value.replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase()
  return normalize(left) === normalize(right)
}

/** Only a different incoming target detaches the old main-owned conflict. */
export function conflictTargetToCancel(
  pendingSaveTarget: string | null,
  conflictTarget: string | undefined,
  incomingTarget: string | undefined,
  pendingTargetKey?: string | null,
  conflictTargetKey?: string,
  incomingTargetKey?: string,
): string | null {
  const current = pendingConflictTarget(pendingSaveTarget, conflictTarget)
  const currentKey = pendingTargetKey ?? conflictTargetKey
  if (currentKey && incomingTargetKey) return currentKey === incomingTargetKey ? null : current
  return current && !sameConflictTarget(current, incomingTarget) ? current : null
}

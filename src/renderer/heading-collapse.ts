/** Advance presentation-only collapsed-heading ancestry for one heading. */
export function collapsedHeadingStep(ancestors: readonly number[], level: number, collapsed: boolean): { hidden: boolean; ancestors: number[] } {
  const next = ancestors.filter((ancestorLevel) => level > ancestorLevel)
  const hidden = next.length > 0
  if (collapsed) next.push(level)
  return { hidden, ancestors: next }
}

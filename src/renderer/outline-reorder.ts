export interface SectionRange {
  start: number
  end: number
}

export interface HeadingBoundary {
  position: number
  level: number
}

/**
 * Determine a heading section's end from the ordered top-level heading
 * boundaries used by the editor. The first equal-or-higher heading wins.
 */
export function sectionEndFromHeadings(start: number, level: number, documentEnd: number, headings: readonly HeadingBoundary[]): number {
  return headings.find((heading) => heading.position > start && heading.level <= level)?.position ?? documentEnd
}

/**
 * Return the insertion point after deleting `source`. Downward drops go after
 * the target's complete section; upward drops go before the target heading.
 */
export function sectionMoveInsertion(source: SectionRange, target: SectionRange): number | null {
  if (source.start === target.start || source.end <= source.start || target.end <= target.start) return null
  // A parent section cannot be moved onto one of its own descendants.
  if (target.start > source.start && target.start < source.end) return null
  if (source.start < target.start) return target.end - (source.end - source.start)
  return target.start
}

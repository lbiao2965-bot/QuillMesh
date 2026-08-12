/**
 * Typora accepts a display formula written on one line as `$$formula$$`.
 * remark-math deliberately parses that form as inline math and serializes it
 * back with a single pair of dollar signs. Normalize formula-only lines to the
 * portable fenced form before Milkdown parses them. A single-dollar
 * formula-only line is also upgraded so files already normalized by an older
 * Earlier editor versions recover their intended display layout.
 */
export function normalizeTyporaBlockMath(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  let fence: { marker: '`' | '~'; length: number } | null = null
  let mathFence = false
  const normalized: string[] = []

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null
      normalized.push(line)
      continue
    }
    if (fence) {
      normalized.push(line)
      continue
    }

    const doubleDollar = line.match(/^(\s{0,3})\$\$\s*(\S(?:[^$]*?\S)?)\s*\$\$\s*$/)
    if (!mathFence && doubleDollar) {
      const [, indent, value] = doubleDollar
      normalized.push(`${indent}$$`, `${indent}${value}`, `${indent}$$`)
      continue
    }

    const mathFenceMatch = line.match(/^(\s{0,3})\$\$\s*$/)
    if (mathFenceMatch) {
      mathFence = !mathFence
      normalized.push(`${mathFenceMatch[1]}$$`)
      continue
    }

    const singleDollar = line.match(/^(\s{0,3})\$(?!\$)\s*(\S(?:[^$]*?\S)?)\s*\$(?!\$)\s*$/)
    if (singleDollar) {
      const [, indent, value] = singleDollar
      if (mathFence) {
        // Repair the malformed `$$` + `$formula$` + `$$` form created by
        // older normalization without nesting another math fence.
        normalized.push(`${indent}${value}`)
      } else {
        normalized.push(`${indent}$$`, `${indent}${value}`, `${indent}$$`)
      }
      continue
    }

    normalized.push(line)
  }

  return normalized.join('\n')
}

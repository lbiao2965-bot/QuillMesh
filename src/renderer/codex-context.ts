export interface CodexTextContext {
  selectedText: string
  line: number
}

export function sourceSelectionContext(markdown: string, selectionStart: number, selectionEnd: number): CodexTextContext {
  const from = Math.max(0, Math.min(markdown.length, Math.min(selectionStart, selectionEnd)))
  const to = Math.max(from, Math.min(markdown.length, Math.max(selectionStart, selectionEnd)))
  return {
    selectedText: markdown.slice(from, to),
    line: markdown.slice(0, from).split('\n').length,
  }
}

export function markdownSectionAtLine(markdown: string, line: number): { heading: string | null; content: string } {
  const lines = markdown.split(/\r\n?|\n/)
  const cursor = Math.max(0, Math.min(lines.length - 1, line - 1))
  let start = 0
  let level = 0
  let heading: string | null = null
  for (let index = cursor; index >= 0; index--) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!match) continue
    start = index
    level = match[1].length
    heading = match[2].trim()
    break
  }
  let end = lines.length
  if (level) for (let index = start + 1; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+/)
    if (match && match[1].length <= level) { end = index; break }
  }
  return { heading, content: lines.slice(start, end).join('\n').trim() }
}

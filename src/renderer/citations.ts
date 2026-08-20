/**
 * 参考文献库：解析 BibTeX / .biblatex / CSL JSON，保存当前加载的条目，
 * 并为编辑器标注、侧栏列表与导出文献节提供统一的数据来源。
 */

export interface BibAuthor {
  family: string
  given: string
}

export interface BibEntry {
  key: string
  type: string
  author: string
  authors: BibAuthor[]
  title: string
  year: string
  venue: string
}

let bibliography = new Map<string, BibEntry>()
let bibliographyPath: string | null = null

export function getBibEntry(key: string): BibEntry | undefined {
  return bibliography.get(key)
}

export function getBibliographyEntries(): BibEntry[] {
  return Array.from(bibliography.values())
}

export function hasBibliography(): boolean {
  return bibliography.size > 0
}

export function getBibliographyPath(): string | null {
  return bibliographyPath
}

// ---------------------------------------------------------------------------
// BibTeX（容忍型解析：花括号配平，不校验字段语义）
// ---------------------------------------------------------------------------

function stripBraces(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** BibTeX 作者字段："Family, Given and Given Family" → 结构化列表。 */
function parseBibAuthors(field: string): BibAuthor[] {
  return field
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes(',')) {
        const [family, ...rest] = part.split(',')
        return { family: family.trim(), given: rest.join(',').trim() }
      }
      const words = part.split(/\s+/)
      if (words.length === 1) return { family: words[0], given: '' }
      return { family: words[words.length - 1], given: words.slice(0, -1).join(' ') }
    })
}

function authorsToString(authors: BibAuthor[]): string {
  return authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join(', ')
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let index = 0
  const length = body.length
  while (index < length) {
    while (index < length && /\s/.test(body[index])) index += 1
    const nameMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(index, index + 64))
    if (!nameMatch) break
    const name = nameMatch[0].toLowerCase()
    index += name.length
    while (index < length && /\s/.test(body[index])) index += 1
    if (body[index] !== '=') break
    index += 1
    while (index < length && /\s/.test(body[index])) index += 1

    let value = ''
    if (body[index] === '{') {
      let depth = 0
      const start = index
      while (index < length) {
        if (body[index] === '{') depth += 1
        else if (body[index] === '}') {
          depth -= 1
          if (depth === 0) {
            index += 1
            break
          }
        }
        index += 1
      }
      value = body.slice(start + 1, index - 1)
    } else if (body[index] === '"') {
      const start = index + 1
      index += 1
      while (index < length && body[index] !== '"') index += 1
      value = body.slice(start, index)
      index += 1
    } else {
      const start = index
      while (index < length && body[index] !== ',' && body[index] !== '\n') index += 1
      value = body.slice(start, index)
    }
    fields[name] = stripBraces(value)
    while (index < length && body[index] !== ',') index += 1
    if (body[index] === ',') index += 1
  }
  return fields
}

export function parseBibTeX(content: string): BibEntry[] {
  const entries: BibEntry[] = []
  const header = /@\s*([A-Za-z]+)\s*([{(])\s*([^,\s]+)\s*,/g
  let match: RegExpExecArray | null
  while ((match = header.exec(content)) !== null) {
    const type = match[1].toLowerCase()
    const open = match[2]
    const key = match[3].trim()
    if (type === 'comment' || type === 'preamble' || type === 'string') continue
    // 从条目体起点做定界符配平，找到该条目结束位置。
    let index = header.lastIndex
    const bodyStart = index
    let end = content.length
    if (open === '{') {
      let depth = 1
      while (index < content.length) {
        if (content[index] === '{') depth += 1
        else if (content[index] === '}') {
          depth -= 1
          if (depth === 0) {
            end = index
            index += 1
            break
          }
        }
        index += 1
      }
    } else {
      // 圆括号定界：跳过配平的花括号组，遇到未配对 ) 即结束。
      let brace = 0
      while (index < content.length) {
        const char = content[index]
        if (char === '{') brace += 1
        else if (char === '}') brace = Math.max(0, brace - 1)
        else if (char === ')' && brace === 0) {
          end = index
          index += 1
          break
        }
        index += 1
      }
    }
    const fields = parseFields(content.slice(bodyStart, end))
    const authors = parseBibAuthors(fields.author ?? fields.editor ?? '')
    entries.push({
      key,
      type,
      author: authorsToString(authors),
      authors,
      title: fields.title ?? '',
      year: fields.year ?? fields.date?.slice(0, 4) ?? '',
      venue: fields.journal ?? fields.journaltitle ?? fields.booktitle ?? fields.publisher ?? fields.school ?? '',
    })
    header.lastIndex = index
  }
  return entries
}

// ---------------------------------------------------------------------------
// CSL JSON
// ---------------------------------------------------------------------------

interface CslName { family?: string; given?: string; literal?: string }

interface CslItem {
  id?: string | number
  type?: string
  title?: string
  author?: CslName[]
  editor?: CslName[]
  issued?: { 'date-parts'?: Array<Array<number | string>> }
  'container-title'?: string
  publisher?: string
}

function formatCslNames(names: CslName[] | undefined): BibAuthor[] {
  if (!Array.isArray(names)) return []
  return names
    .map((name): BibAuthor | null => {
      if (name.literal) return { family: name.literal, given: '' }
      if (!name.family) return null
      return { family: name.family, given: name.given ?? '' }
    })
    .filter((author): author is BibAuthor => author !== null)
}

export function parseCslJson(content: string): BibEntry[] {
  const parsed = JSON.parse(content) as unknown
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const entries: BibEntry[] = []
  for (const item of items as CslItem[]) {
    if (!item || typeof item !== 'object') continue
    const key = item.id !== undefined ? String(item.id) : ''
    if (!key) continue
    const dateParts = item.issued?.['date-parts']?.[0]?.[0]
    const authors = formatCslNames(item.author).length ? formatCslNames(item.author) : formatCslNames(item.editor)
    entries.push({
      key,
      type: item.type ?? 'article',
      author: authorsToString(authors),
      authors,
      title: item.title ?? '',
      year: dateParts !== undefined ? String(dateParts) : '',
      venue: item['container-title'] ?? item.publisher ?? '',
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// 加载与格式化
// ---------------------------------------------------------------------------

export function loadBibliographyContent(content: string, path: string | null): number {
  const trimmed = content.trimStart()
  let entries: BibEntry[] = []
  try {
    entries = trimmed.startsWith('[') || trimmed.startsWith('{') ? parseCslJson(content) : parseBibTeX(content)
  } catch {
    entries = []
  }
  bibliography = new Map(entries.map((entry) => [entry.key, entry]))
  // Keep the authorized path even for a brand-new empty .bib file so the
  // first entry can be persisted instead of becoming session-only state.
  bibliographyPath = path
  window.dispatchEvent(new CustomEvent('quill-bibliography-changed'))
  return entries.length
}

/** "作者 (年份). 标题. 期刊/出版社." —— 缺哪段省哪段。 */
export function formatEntry(entry: BibEntry): string {
  const parts: string[] = []
  if (entry.author) parts.push((entry.year ? `${entry.author} (${entry.year})` : entry.author).replace(/\.+$/, '') + '.')
  else if (entry.year) parts.push(`(${entry.year}).`)
  if (entry.title) parts.push(entry.title.replace(/\.+$/, '') + '.')
  if (entry.venue) parts.push(entry.venue.replace(/\.+$/, '') + '.')
  return parts.join(' ')
}

/** 合并新条目进当前引用库（同 key 覆盖），供"新增 BibTeX 文献"使用。 */
export function addBibliographyEntries(entries: BibEntry[]): number {
  if (!entries.length) return 0
  bibliography = new Map(bibliography)
  for (const entry of entries) bibliography.set(entry.key, entry)
  window.dispatchEvent(new CustomEvent('quill-bibliography-changed'))
  return entries.length
}

// ---------------------------------------------------------------------------
// 引文格式：APA / MLA / Chicago / GB/T 7714
// ---------------------------------------------------------------------------

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'gbt'

export const citationStyles: CitationStyle[] = ['apa', 'mla', 'chicago', 'gbt']

function givenInitials(given: string, withPeriod: boolean): string {
  return given
    .split(/[\s\-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${withPeriod ? '.' : ''}`)
    .join(withPeriod ? ' ' : '')
}

function apaAuthors(authors: BibAuthor[]): string {
  const names = authors.map((a) => (a.given ? `${a.family}, ${givenInitials(a.given, true)}` : a.family))
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return `${names[0]}, & ${names[1]}`
  if (names.length <= 7) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
  return `${names[0]} et al.`
}

function mlaAuthors(authors: BibAuthor[]): string {
  if (!authors.length) return ''
  const full = (a: BibAuthor) => (a.given ? `${a.given} ${a.family}` : a.family)
  const first = authors[0].given ? `${authors[0].family}, ${authors[0].given}` : authors[0].family
  if (authors.length === 1) return first
  if (authors.length === 2) return `${first}, and ${full(authors[1])}`
  return `${first}, et al.`
}

function chicagoAuthors(authors: BibAuthor[]): string {
  if (!authors.length) return ''
  const full = (a: BibAuthor) => (a.given ? `${a.given} ${a.family}` : a.family)
  const first = authors[0].given ? `${authors[0].family}, ${authors[0].given}` : authors[0].family
  if (authors.length === 1) return first
  if (authors.length === 2) return `${first}, and ${full(authors[1])}`
  const rest = authors.slice(1).map(full)
  return `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`
}

function gbtAuthors(authors: BibAuthor[]): string {
  const names = authors.map((a) => `${a.family.toUpperCase()}${a.given ? ` ${givenInitials(a.given, false)}` : ''}`)
  const hasCjk = authors.some((a) => /[一-鿿]/.test(a.family))
  const suffix = hasCjk ? ', 等' : ', et al'
  if (names.length > 3) return `${names.slice(0, 3).join(', ')}${suffix}`
  return names.join(', ')
}

/** GB/T 7714 文献类型标志。 */
function gbtMarker(entry: BibEntry): string {
  const type = entry.type.toLowerCase()
  if (type === 'book') return 'M'
  if (type.includes('proceeding') || type.includes('conference') || type === 'incollection') return 'C'
  if (type.includes('thesis') || type === 'phdthesis' || type === 'mastersthesis') return 'D'
  if (type === 'article' || type.includes('journal')) return 'J'
  return 'EB/OL'
}

function stripEndPeriod(text: string): string {
  return text.replace(/\.+$/, '')
}

/** 追加句点，但已有结尾标点时不重复。 */
function sentence(text: string): string {
  return /[.!?。]$/.test(text) ? text : `${text}.`
}

/** 按指定引文格式格式化单条文献（基于现有字段的实用近似）。 */
export function formatEntryStyled(entry: BibEntry, style: CitationStyle): string {
  const title = stripEndPeriod(entry.title)
  const venue = stripEndPeriod(entry.venue)
  const { year } = entry
  switch (style) {
    case 'apa': {
      const head = apaAuthors(entry.authors)
      const parts = [head && `${head}${year ? ` (${year})` : ''}.`, !head && year && `(${year}).`, title && `${title}.`, venue && `${venue}.`]
      return parts.filter(Boolean).join(' ')
    }
    case 'mla': {
      const head = mlaAuthors(entry.authors)
      const tail = [venue, year].filter(Boolean).join(', ')
      return [head && sentence(head), title && `"${title}."`, tail && sentence(tail)].filter(Boolean).join(' ')
    }
    case 'chicago': {
      const head = chicagoAuthors(entry.authors)
      return [head && sentence(head), year && `${year}.`, title && `"${title}."`, venue && sentence(venue)].filter(Boolean).join(' ')
    }
    case 'gbt': {
      const head = gbtAuthors(entry.authors)
      const tail = [venue, year].filter(Boolean).join(', ')
      return [head && `${head}.`, title && `${title}[${gbtMarker(entry)}]`, tail && `${tail}.`].filter(Boolean).join('. ').replace(/\.{2,}/g, '.')
    }
  }
}

// ---------------------------------------------------------------------------
// 文中引用键提取（跳过代码围栏，按首次出现顺序去重）
// ---------------------------------------------------------------------------

const CITE_PATTERN = /\[@([^\]]+)\]/g

function splitKeys(group: string): string[] {
  return group.split(';').map((key) => key.trim().replace(/^@/, '')).filter(Boolean)
}

interface FenceState { marker: '`' | '~'; length: number }

function openingFence(line: string): FenceState | null {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line)
  if (!match) return null
  return { marker: match[2][0] as '`' | '~', length: match[2].length }
}

function closesFence(line: string, fence: FenceState): boolean {
  const expression = fence.marker === '`' ? /^( {0,3})(`{3,})[ \t]*$/ : /^( {0,3})(~{3,})[ \t]*$/
  const match = expression.exec(line)
  return Boolean(match && match[2].length >= fence.length)
}

/** Apply a transform only to prose outside CommonMark inline-code spans. */
function mapInlineCode(line: string, transform: (plain: string) => string, code: (span: string) => string): string {
  let output = ''
  let plainStart = 0
  let cursor = 0
  while (cursor < line.length) {
    if (line[cursor] !== '`') { cursor += 1; continue }
    let length = 1
    while (line[cursor + length] === '`') length += 1
    let search = cursor + length
    let close = -1
    while (search < line.length) {
      const next = line.indexOf('`', search)
      if (next < 0) break
      let closeLength = 1
      while (line[next + closeLength] === '`') closeLength += 1
      if (closeLength === length) { close = next; break }
      search = next + closeLength
    }
    if (close < 0) { cursor += length; continue }
    output += transform(line.slice(plainStart, cursor))
    output += code(line.slice(cursor, close + length))
    cursor = close + length
    plainStart = cursor
  }
  return output + transform(line.slice(plainStart))
}

/** Mask fenced, indented, and inline code so citekeys in examples are ignored. */
function maskMarkdownCode(markdown: string): string {
  const lines = markdown.split('\n')
  let fence: FenceState | null = null
  return lines.map((line) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null
      return ' '.repeat(line.length)
    }
    const opening = openingFence(line)
    if (opening) { fence = opening; return ' '.repeat(line.length) }
    if (/^(?: {4}|\t)/.test(line)) return ' '.repeat(line.length)
    return mapInlineCode(line, (plain) => plain, (span) => ' '.repeat(span.length))
  }).join('\n')
}

export function extractCiteKeysFromMarkdown(markdown: string): string[] {
  const withoutFences = maskMarkdownCode(markdown)
  const keys: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  CITE_PATTERN.lastIndex = 0
  while ((match = CITE_PATTERN.exec(withoutFences)) !== null) {
    for (const key of splitKeys(match[1])) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  return keys
}

/**
 * remark-stringify escapes unknown bracket syntax as `\[@key]`. Citations are
 * intentionally stored as Pandoc-compatible `[@key]`, so remove only that
 * serializer-added escape outside fenced and inline code. Literal examples in
 * code remain byte-for-byte unchanged.
 */
export function normalizeCitationMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  let fence: FenceState | null = null
  return lines.map((line) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null
      return line
    }
    const opening = openingFence(line)
    if (opening) { fence = opening; return line }
    if (/^(?: {4}|\t)/.test(line)) return line
    return mapInlineCode(line, (plain) => plain.replace(/\\(\[@[^\]\r\n]+\])/g, '$1'), (span) => span)
  }).join('\n')
}

export interface BibliographyLoadToken { documentId: string; epoch: number }

/** Reject stale async bibliography reads after a fast tab switch. */
export class BibliographyLoadGuard {
  private epoch = 0

  begin(documentId: string): BibliographyLoadToken {
    return { documentId, epoch: ++this.epoch }
  }

  isCurrent(token: BibliographyLoadToken, activeDocumentId: string | null): boolean {
    return token.epoch === this.epoch && token.documentId === activeDocumentId
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 导出时的参考文献节：按文中引用顺序、指定引文格式列出已解析的条目。
 * 未加载引用库或正文没有引用时返回空串，不改动导出文档。
 */
export function buildReferencesHtml(markdown: string, heading: string, style: CitationStyle = 'gbt'): string {
  if (!hasBibliography()) return ''
  const keys = extractCiteKeysFromMarkdown(markdown)
  const items = keys
    .map((key) => getBibEntry(key))
    .filter((entry): entry is BibEntry => Boolean(entry))
  if (!items.length) return ''
  const list = items.map((entry) => `    <li id="ref-${escapeHtml(entry.key)}">${escapeHtml(formatEntryStyled(entry, style))}</li>`).join('\n')
  return `<section class="references-section">\n  <hr>\n  <h2>${escapeHtml(heading)}</h2>\n  <ol>\n${list}\n  </ol>\n</section>\n`
}

/** 文中引用的条目（按引用顺序），供下栏面板与一键复制使用。 */
export function citedEntries(markdown: string): Array<{ key: string; entry: BibEntry | undefined }> {
  return extractCiteKeysFromMarkdown(markdown).map((key) => ({ key, entry: getBibEntry(key) }))
}

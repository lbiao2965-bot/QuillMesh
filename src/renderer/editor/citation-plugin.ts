import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { $prose } from '@milkdown/kit/utils'
import { formatEntry, getBibEntry, hasBibliography } from '../citations'
import { t } from '../i18n'

// ---------------------------------------------------------------------------
// 引用标注：正文中的 [@key] 加样式，缺失键红色提示；
// 显示样式可在 @第一作者（默认）与数字编号 [1] 之间切换。
// ---------------------------------------------------------------------------

export const citationMarkPluginKey = new PluginKey<DecorationSet>('citation-marks')

export type CitationDisplay = 'author' | 'numeric'

let citationDisplay: CitationDisplay = 'author'

/** 切换正文引文标注的显示样式（调用方负责触发标注重算）。 */
export function setCitationDisplay(mode: CitationDisplay): void {
  citationDisplay = mode
}

export function getCitationDisplay(): CitationDisplay {
  return citationDisplay
}

const INLINE_SKIP = new Set(['code_block', 'math_block', 'math_inline'])
const CITE_IN_TEXT = /\[@([^\]]+)\]/g

interface CiteMatch {
  from: number
  to: number
  keys: string[]
}

function collectCiteMatches(doc: PMNode): CiteMatch[] {
  const matches: CiteMatch[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      // 行内代码中的 [@key] 是字面文本，不是引用，跳过（与参考文献列表提取逻辑一致）。
      if (node.marks.some((mark) => mark.type.name === 'inlineCode' || mark.type.name === 'code')) return false
      CITE_IN_TEXT.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = CITE_IN_TEXT.exec(node.text)) !== null) {
        const from = pos + match.index
        const to = from + match[0].length
        const keys = match[1].split(';').map((key) => key.trim().replace(/^@/, '')).filter(Boolean)
        if (keys.length) matches.push({ from, to, keys })
      }
      return false
    }
    if (INLINE_SKIP.has(node.type.name)) return false
    return true
  })
  return matches
}

/** 标注显示文本：@第一作者（多位作者加 et al.）或按首次出现顺序的 [编号]。 */
function citeLabel(keys: string[], order: Map<string, number>): string {
  if (citationDisplay === 'numeric') {
    const nums = keys
      .map((key) => order.get(key))
      .filter((num): num is number => typeof num === 'number')
    if (nums.length) return `[${nums.join(', ')}]`
    return keys.map((key) => `@${key}`).join('; ')
  }
  return keys.map((key) => {
    const entry = getBibEntry(key)
    const family = entry?.authors[0]?.family ?? ''
    if (!entry || !family) return `@${key}`
    return entry.authors.length > 1 ? `@${family} et al.` : `@${family}`
  }).join('; ')
}

function computeCiteDecorations(doc: PMNode): DecorationSet {
  const matches = collectCiteMatches(doc)
  // 编号顺序 = 文献在正文中首次出现的顺序，与下栏参考文献列表一致。
  const order = new Map<string, number>()
  for (const match of matches) {
    for (const key of match.keys) {
      if (!order.has(key)) order.set(key, order.size + 1)
    }
  }
  const loaded = hasBibliography()
  const decorations = matches.map((match) => {
    const missing = loaded && match.keys.some((key) => !getBibEntry(key))
    return Decoration.inline(match.from, match.to, {
      class: missing ? 'cite-mark cite-mark-missing' : 'cite-mark',
      'data-cite-keys': match.keys.join(' '),
      'data-cite-label': citeLabel(match.keys, order),
    })
  })
  return DecorationSet.create(doc, decorations)
}

export const citationMarkPlugin = $prose(() => new Plugin({
  key: citationMarkPluginKey,
  state: {
    init: (_, state) => computeCiteDecorations(state.doc),
    apply(tr, set, _old, state) {
      if (tr.docChanged || tr.getMeta(citationMarkPluginKey)) return computeCiteDecorations(state.doc)
      return set.map(tr.mapping, tr.doc)
    },
  },
  props: {
    decorations(state) {
      return citationMarkPluginKey.getState(state) ?? DecorationSet.empty
    },
  },
}))

/** 引用库加载/更换后强制重新标注（缺失键状态与作者名可能变化）。 */
export function installCitationStoreSync(refresh: () => void): void {
  window.addEventListener('quill-bibliography-changed', refresh)
}

// ---------------------------------------------------------------------------
// 引用悬浮预览
// ---------------------------------------------------------------------------

let tooltipEl: HTMLDivElement | null = null
let tooltipTimer: number | null = null

function hideTooltip(): void {
  if (tooltipTimer !== null) {
    window.clearTimeout(tooltipTimer)
    tooltipTimer = null
  }
  tooltipEl?.remove()
  tooltipEl = null
}

function showTooltip(mark: HTMLElement): void {
  hideTooltip()
  const keys = (mark.dataset.citeKeys ?? '').split(' ').filter(Boolean)
  if (!keys.length) return
  const tooltip = document.createElement('div')
  tooltip.className = 'cite-tooltip'
  for (const key of keys) {
    const entry = getBibEntry(key)
    const row = document.createElement('div')
    row.className = entry ? 'cite-tooltip-entry' : 'cite-tooltip-entry missing'
    row.textContent = entry ? formatEntry(entry) : `${t('citeMissing')}: @${key}`
    tooltip.appendChild(row)
  }
  document.body.appendChild(tooltip)
  tooltipEl = tooltip
  const rect = mark.getBoundingClientRect()
  const margin = 8
  const width = tooltip.offsetWidth
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin))
  let top = rect.bottom + 6
  if (top + tooltip.offsetHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - tooltip.offsetHeight - 6)
  }
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

/** 在编辑器根元素上以事件委托方式安装引用悬浮预览。 */
export function installCitationHover(root: HTMLElement): void {
  root.addEventListener('mouseover', (event) => {
    const mark = (event.target as HTMLElement).closest<HTMLElement>('.cite-mark')
    if (mark && root.contains(mark)) showTooltip(mark)
  })
  root.addEventListener('mouseout', (event) => {
    if ((event.target as HTMLElement).closest('.cite-mark')) {
      if (tooltipTimer !== null) window.clearTimeout(tooltipTimer)
      tooltipTimer = window.setTimeout(hideTooltip, 160)
    }
  })
  root.addEventListener('scroll', hideTooltip, { passive: true })
  // 点击引文标记：通知主进程界面在下栏中定位并选中对应文献。
  root.addEventListener('click', (event) => {
    const mark = (event.target as HTMLElement).closest<HTMLElement>('.cite-mark')
    if (!mark || !root.contains(mark)) return
    const key = (mark.dataset.citeKeys ?? '').split(' ').filter(Boolean)[0]
    if (key) window.dispatchEvent(new CustomEvent('quill-citation-reveal', { detail: key }))
  })
  window.addEventListener('quill-bibliography-changed', hideTooltip)
}

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, remarkPluginsCtx, remarkStringifyOptionsCtx, commandsCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { CellSelection, deleteColumn, deleteRow, deleteTable } from '@milkdown/kit/prose/tables'
import remarkBreaks from 'remark-breaks'
import { commonmark, insertHrCommand } from '@milkdown/kit/preset/commonmark'
import {
  gfm,
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  columnResizingPlugin,
  insertTableCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { replaceAll, $inputRule, $nodeSchema, $prose } from '@milkdown/kit/utils'
import katex from 'katex'
import { htmlView } from './html-view'
import { imageView } from './image-view'
import { mathModal } from './math-modal'
import { highlight, remarkHighlight, highlightStringifyHandler } from './highlight'
import { ImageViewer } from './image-viewer'
import { normalizeTyporaBlockMath } from './math-compat'
import { katexOptionsCtx, mathInlineInputRule, mathInlineSchema, remarkMathPlugin } from './math-plugin'
import { mermaidPlugin } from './mermaid-view'
import { citationMarkPlugin, citationMarkPluginKey, installCitationHover, installCitationStoreSync } from './citation-plugin'
import { normalizeCitationMarkdown } from '../citations'
import { t } from '../i18n'
import { sectionEndFromHeadings, sectionMoveInsertion } from '../outline-reorder'
import { collapsedHeadingStep } from '../heading-collapse'
import { iconSvg, setButtonIcon } from '../icons'

import 'katex/dist/katex.min.css'
import '@milkdown/kit/prose/view/style/prosemirror.css'

export const searchPluginKey = new PluginKey('search-highlight')
export const headingCollapsePluginKey = new PluginKey<DecorationSet>('heading-collapse')

const displayMathBlockSchema = $nodeSchema('math_block', (ctx) => ({
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  atom: true,
  isolating: true,
  attrs: { value: { default: '' } },
  parseDOM: [{
    tag: 'div[data-type="math_block"]',
    preserveWhitespace: 'full',
    getAttrs: (dom) => dom instanceof HTMLElement ? { value: dom.dataset.value ?? '' } : false,
  }],
  toDOM: (node) => {
    const code = String(node.attrs.value ?? '')
    const dom = document.createElement('div')
    dom.dataset.type = 'math_block'
    dom.dataset.value = code
    katex.render(code, dom, { ...ctx.get(katexOptionsCtx.key), displayMode: true })
    return dom
  },
  parseMarkdown: {
    match: ({ type }) => type === 'math',
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? '') }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => state.addNode('math', undefined, String(node.attrs.value ?? '')),
  },
}))

const displayMathBlockInputRule = $inputRule((ctx) =>
  new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    if (!$start.node(-1).canReplaceWith(
      $start.index(-1),
      $start.indexAfter(-1),
      displayMathBlockSchema.type(ctx)
    )) return null
    return state.tr
      .delete(start, end)
      .setBlockType(start, start, displayMathBlockSchema.type(ctx))
  })
)

const searchHighlight = $prose(() => {
  return new Plugin({
    key: searchPluginKey,
    state: {
      init() {
        return DecorationSet.empty
      },
      apply(tr, old) {
        const meta = tr.getMeta(searchPluginKey)
        if (meta !== undefined) return meta
        return old.map(tr.mapping, tr.doc)
      }
    },
    props: {
      decorations(state) {
        return searchPluginKey.getState(state)
      }
    }
  })
})

const activeBlockPlugin = $prose(() => {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection
        if ($from.depth < 1) return DecorationSet.empty
        const node = $from.node(1)
        const from = $from.before(1)
        return DecorationSet.create(state.doc, [
          Decoration.node(from, from + node.nodeSize, { class: 'focus-active' }),
        ])
      },
    },
    view() {
      return {
        update() {
          window.dispatchEvent(new Event('colamd-selection-updated'))
        },
      }
    },
  })
})

const headingCollapsePlugin = $prose(() => new Plugin({
  key: headingCollapsePluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, previous) {
      const replacement = transaction.getMeta(headingCollapsePluginKey) as DecorationSet | undefined
      return replacement ?? previous.map(transaction.mapping, transaction.doc)
    },
  },
  props: {
    decorations(state) { return headingCollapsePluginKey.getState(state) ?? DecorationSet.empty },
  },
}))

export const commentMarkPluginKey = new PluginKey<DecorationSet>('comment-marks')

const commentMarkPlugin = $prose(() => new Plugin({
  key: commentMarkPluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, previous) {
      const replacement = transaction.getMeta(commentMarkPluginKey) as DecorationSet | undefined
      return replacement ?? previous.map(transaction.mapping, transaction.doc)
    },
  },
  props: {
    decorations(state) { return commentMarkPluginKey.getState(state) ?? DecorationSet.empty },
  },
}))

const documentChangePlugin = $prose(() => new Plugin({
  appendTransaction(transactions) {
    if (transactions.some((transaction) => transaction.docChanged)) {
      queueMicrotask(() => window.dispatchEvent(new Event('colamd-document-changed')))
    }
    return null
  },
}))

const mathEditorPlugin = $prose(() => {
  return new Plugin({
    props: {
      handleClickOn(_view, _pos, node, nodePos) {
        if (node.type.name === 'math_inline' || node.type.name === 'math_block') {
          const isBlock = node.type.name === 'math_block'
          const currentValue = isBlock ? node.attrs.value : node.textContent
          mathModal.show(currentValue, isBlock, nodePos)
          return true
        }
        return false
      }
    }
  })
})

export function showMathModal(): void {
  mathModal.show()
}

let editorInstance: Editor | null = null
const imageViewer = new ImageViewer()
let imagePasteHandler: ((file: File) => Promise<void>) | null = null

export function setImagePasteHandler(handler: ((file: File) => Promise<void>) | null): void {
  imagePasteHandler = handler
}

export function isImageViewerOpen(): boolean {
  return imageViewer.isOpen
}

export function openImagePreview(src: string, alt: string): void {
  imageViewer.open({ src, alt })
}

export type FormattingCommand =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'strong'
  | 'emphasis'
  | 'link'
  | 'inline-code'
  | 'code-fence'
  | 'quote'
  | 'horizontal-rule'
  | 'ordered-list'
  | 'unordered-list'
  | 'task-list'
  | 'heading-promote'
  | 'heading-demote'

const formattingCommands = new Set<FormattingCommand>([
  'paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
  'strong', 'emphasis', 'link', 'inline-code', 'code-fence', 'quote', 'horizontal-rule',
  'ordered-list', 'unordered-list', 'task-list', 'heading-promote', 'heading-demote',
])

function runCommand(command: ReturnType<typeof setBlockType> | ReturnType<typeof toggleMark> | ReturnType<typeof wrapIn> | ReturnType<typeof wrapInList>): boolean {
  const view = getEditorView()
  if (!view) return false
  const handled = command(view.state, view.dispatch, view)
  if (handled) view.focus()
  return handled
}

export function runFormattingCommand(command: string): boolean {
  if (isImageViewerOpen()) return false
  if (!formattingCommands.has(command as FormattingCommand)) return false
  const view = getEditorView()
  if (!view) return false
  const { nodes, marks } = view.state.schema

  switch (command) {
    case 'paragraph': return runCommand(setBlockType(nodes.paragraph))
    case 'heading-1': return runCommand(setBlockType(nodes.heading, { level: 1 }))
    case 'heading-2': return runCommand(setBlockType(nodes.heading, { level: 2 }))
    case 'heading-3': return runCommand(setBlockType(nodes.heading, { level: 3 }))
    case 'heading-4': return runCommand(setBlockType(nodes.heading, { level: 4 }))
    case 'heading-5': return runCommand(setBlockType(nodes.heading, { level: 5 }))
    case 'heading-6': return runCommand(setBlockType(nodes.heading, { level: 6 }))
    case 'strong': return runCommand(toggleMark(marks.strong))
    case 'emphasis': return runCommand(toggleMark(marks.emphasis))
    case 'inline-code': return runCommand(toggleMark(marks.inline_code))
    case 'code-fence': return runCommand(setBlockType(nodes.code_block))
    case 'quote': return runCommand(wrapIn(nodes.blockquote))
    case 'horizontal-rule': {
      if (!editorInstance) return false
      let handled = false
      editorInstance.action((ctx) => { handled = ctx.get(commandsCtx).call(insertHrCommand.key) })
      if (handled) view.focus()
      return handled
    }
    case 'ordered-list': return runCommand(wrapInList(nodes.ordered_list))
    case 'unordered-list': return runCommand(wrapInList(nodes.bullet_list))
    case 'task-list': return makeTaskList()
    case 'heading-promote': return changeHeadingLevel(-1)
    case 'heading-demote': return changeHeadingLevel(1)
    case 'link': {
      const href = window.prompt(t('enterLinkUrl'))?.trim()
      return href ? runCommand(toggleMark(marks.link, { href })) : false
    }
  }
  return false
}

export function insertTable(rows = 3, columns = 3): boolean {
  if (!editorInstance || isImageViewerOpen()) return false
  let handled = false
  editorInstance.action((ctx) => {
    handled = ctx.get(commandsCtx).call(insertTableCommand.key, { row: Math.max(2, rows), col: Math.max(2, columns) })
  })
  return handled
}

function selectTableCell(target?: HTMLElement | null): boolean {
  const cell = target?.closest<HTMLTableCellElement>('td,th')
  const view = getEditorView()
  if (!cell || !view) return false
  try {
    const $from = view.state.doc.resolve(view.posAtDOM(cell, 0))
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.spec.tableRole !== 'cell' && node.type.spec.tableRole !== 'header_cell') continue
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $from.before(depth))))
      return true
    }
  } catch {}
  return false
}

export type TableCommand =
  | 'add-row-before'
  | 'add-row-after'
  | 'add-column-before'
  | 'add-column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'
  | 'align-left'
  | 'align-center'
  | 'align-right'

function tableCellPosition(view: EditorView, cell: HTMLTableCellElement): number | null {
  try {
    const $from = view.state.doc.resolve(view.posAtDOM(cell, 0))
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') return $from.before(depth)
    }
  } catch {}
  return null
}

function selectEntireTable(target?: HTMLElement | null): boolean {
  const cell = target?.closest<HTMLTableCellElement>('td,th')
  const view = getEditorView()
  if (!cell || !view) return false
  const table = cell.closest('table')
  const cells = table ? Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td')) : []
  const first = cells[0] ? tableCellPosition(view, cells[0]) : null
  const last = cells.length ? tableCellPosition(view, cells[cells.length - 1]) : null
  if (first === null || last === null) return false
  view.dispatch(view.state.tr.setSelection(new CellSelection(view.state.doc.resolve(last), view.state.doc.resolve(first))))
  return true
}

/** GFM permits exactly one header row. Inserting above it therefore creates a
 * new header and demotes the old header to the first ordinary data row. */
function insertRowBeforeHeader(target?: HTMLElement | null): boolean {
  const cell = target?.closest<HTMLTableCellElement>('td,th')
  const row = cell?.parentElement
  const view = getEditorView()
  if (!cell || !(row instanceof HTMLTableRowElement) || row.rowIndex !== 0 || !view) return false
  try {
    const $from = view.state.doc.resolve(view.posAtDOM(cell, 0))
    let tableDepth = -1
    for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'table') { tableDepth = depth; break }
    if (tableDepth < 0) return false
    const table = $from.node(tableDepth)
    const tablePosition = $from.before(tableDepth)
    const oldHeader = table.firstChild
    const { table_header_row: headerRowType, table_header: headerCellType, table_row: rowType, table_cell: cellType } = view.state.schema.nodes
    if (!oldHeader || !headerRowType || !headerCellType || !rowType || !cellType) return false
    const newHeaderCells: NonNullable<ReturnType<typeof headerCellType.createAndFill>>[] = []
    const demotedCells: ReturnType<typeof cellType.create>[] = []
    oldHeader.forEach((headerCell) => {
      const newHeaderCell = headerCellType.createAndFill({ alignment: headerCell.attrs.alignment })
      if (!newHeaderCell) throw new Error('Unable to create table header cell')
      newHeaderCells.push(newHeaderCell)
      demotedCells.push(cellType.create({ alignment: headerCell.attrs.alignment }, headerCell.content))
    })
    const remainingRows: typeof oldHeader[] = []
    for (let index = 1; index < table.childCount; index++) remainingRows.push(table.child(index))
    const newHeader = headerRowType.create(null, newHeaderCells)
    const oldHeaderAsRow = rowType.create(null, demotedCells)
    const replacement = table.type.create(table.attrs, [newHeader, oldHeaderAsRow, ...remainingRows])
    view.dispatch(view.state.tr.replaceWith(tablePosition, tablePosition + table.nodeSize, replacement).scrollIntoView())
    view.focus()
    return true
  } catch {
    return false
  }
}

export function runTableCommand(command: TableCommand, target?: HTMLElement | null): boolean {
  if (!editorInstance) return false
  if (command === 'add-row-before' && target?.closest<HTMLTableRowElement>('tr')?.rowIndex === 0) return insertRowBeforeHeader(target)
  // Contextual controls must operate on the cell under the pointer, not on a
  // stale cursor left in a different table (or outside every table).
  const alignment = command.startsWith('align-')
  if (target && !(alignment ? selectEntireTable(target) : selectTableCell(target))) return false
  if (command === 'delete-row' || command === 'delete-column' || command === 'delete-table') {
    const view = getEditorView()
    if (!view) return false
    const tableCommand = command === 'delete-row' ? deleteRow : command === 'delete-column' ? deleteColumn : deleteTable
    const handled = tableCommand(view.state, view.dispatch)
    if (handled) view.focus()
    return handled
  }
  let handled = false
  editorInstance.action((ctx) => {
    const commandManager = ctx.get(commandsCtx)
    if (command === 'align-left' || command === 'align-center' || command === 'align-right') {
      handled = commandManager.call(setAlignCommand.key, command.slice(6) as 'left' | 'center' | 'right')
    } else {
      const insertion = command === 'add-row-before' ? addRowBeforeCommand
        : command === 'add-row-after' ? addRowAfterCommand
          : command === 'add-column-before' ? addColBeforeCommand
            : addColAfterCommand
      handled = commandManager.call(insertion.key)
    }
  })
  return handled
}

export function insertParagraphNearSelection(direction: 'before' | 'after'): boolean {
  const view = getEditorView()
  const paragraph = view?.state.schema.nodes.paragraph
  if (!view || !paragraph) return false
  const { $from } = view.state.selection
  const depth = Math.min(1, $from.depth)
  const position = depth > 0
    ? direction === 'before' ? $from.before(depth) : $from.after(depth)
    : direction === 'before' ? 0 : view.state.doc.content.size
  const transaction = view.state.tr.insert(position, paragraph.create()).scrollIntoView()
  view.dispatch(transaction)
  view.focus()
  return true
}

export function insertImageMarkdown(source: string, alt = 'Pasted image'): boolean {
  const view = getEditorView()
  if (!view || !source) return false
  const image = view.state.schema.nodes.image
  if (!image) return false
  view.dispatch(view.state.tr.replaceSelectionWith(image.create({ src: source, alt })).scrollIntoView())
  view.focus()
  return true
}

/** Return the Markdown source stored in the image node, not its rendered data URL. */
export function imageMarkdownSourceAt(element: HTMLElement): string | null {
  const image = element.closest('img')
  const view = getEditorView()
  if (!image || !view) return null
  const preservedSource = image.dataset.colamdSource
  if (preservedSource) return preservedSource
  try {
    const pos = view.posAtDOM(image, 0)
    const node = view.state.doc.nodeAt(pos) ?? view.state.doc.nodeAt(Math.max(0, pos - 1))
    return node?.type.name === 'image' && typeof node.attrs.src === 'string' ? node.attrs.src : null
  } catch { return null }
}

function escapeImageAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Persist a visual resize as portable inline HTML understood by Typora and browsers. */
export function setImageWidthAt(element: HTMLImageElement, width: number | null): boolean {
  const view = getEditorView()
  if (!view) return false
  const normalizedWidth = width === null ? null : Math.max(48, Math.round(width))
  try {
    const htmlWrapper = element.closest<HTMLElement>('.milkdown-html-inline')
    if (htmlWrapper) {
      const pos = view.posAtDOM(htmlWrapper, 0)
      const node = view.state.doc.nodeAt(pos) ?? view.state.doc.nodeAt(Math.max(0, pos - 1))
      const nodePos = view.state.doc.nodeAt(pos)?.type.name === 'html' ? pos : pos - 1
      if (node?.type.name !== 'html' || nodePos < 0) return false
      const container = document.createElement('span')
      container.innerHTML = String(node.attrs.value ?? '')
      const rendered = Array.from(htmlWrapper.querySelectorAll('img'))
      const index = Math.max(0, rendered.indexOf(element))
      const target = container.querySelectorAll('img')[index]
      if (!target) return false
      if (normalizedWidth === null) target.removeAttribute('width')
      else target.setAttribute('width', String(normalizedWidth))
      target.removeAttribute('height')
      target.style.removeProperty('width')
      target.style.removeProperty('height')
      view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, value: container.innerHTML }).scrollIntoView())
      return true
    }

    const domPos = view.posAtDOM(element, 0)
    const direct = view.state.doc.nodeAt(domPos)
    const previous = domPos > 0 ? view.state.doc.nodeAt(domPos - 1) : null
    const node = direct?.type.name === 'image' ? direct : previous?.type.name === 'image' ? previous : null
    const pos = direct?.type.name === 'image' ? domPos : domPos - 1
    if (!node || pos < 0) return false
    if (normalizedWidth === null) return true
    const html = view.state.schema.nodes.html
    if (!html) return false
    const source = escapeImageAttribute(String(node.attrs.src ?? ''))
    const alt = escapeImageAttribute(String(node.attrs.alt ?? ''))
    const title = String(node.attrs.title ?? '')
    const titleAttribute = title ? ` title="${escapeImageAttribute(title)}"` : ''
    const value = `<img src="${source}" alt="${alt}"${titleAttribute} width="${normalizedWidth}">`
    view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, html.create({ value })).scrollIntoView())
    return true
  } catch {
    return false
  }
}

export function isManagedRelativeImageSource(source: string): boolean {
  const value = source.trim()
  return Boolean(value) && !/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/|\\|#)/.test(value)
}

/** Returns a slash query only when the slash begins a plain text insertion query. */
export function getSlashQuery(): string | null {
  const view = getEditorView()
  if (!view || !view.state.selection.empty) return null
  const { $from } = view.state.selection
  if (!$from.parent.isTextblock) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const index = before.lastIndexOf('/')
  if (index < 0 || (index > 0 && !/\s/.test(before[index - 1]))) return null
  return before.slice(index + 1)
}

export function clearSlashQuery(): boolean {
  const query = getSlashQuery()
  const view = getEditorView()
  if (query === null || !view) return false
  const end = view.state.selection.from
  view.dispatch(view.state.tr.delete(end - query.length - 1, end).scrollIntoView())
  view.focus()
  return true
}

export function moveHeadingSection(sourcePos: number, targetPos: number): boolean {
  const view = getEditorView()
  if (!view || sourcePos === targetPos) return false
  const source = view.state.doc.nodeAt(sourcePos)
  const target = view.state.doc.nodeAt(targetPos)
  if (!source || !target || source.type.name !== 'heading' || target.type.name !== 'heading') return false
  const headingBoundaries: { position: number; level: number }[] = []
  // Markdown headings are top-level document blocks. Iterating those blocks
  // finds the first following equal/higher heading exactly once; nodesBetween
  // returning false only skips descendants and does not stop sibling scans.
  view.state.doc.forEach((node, position) => {
    if (node.type.name === 'heading') headingBoundaries.push({ position, level: Number(node.attrs.level) })
  })
  const sectionEnd = (start: number, level: number): number => {
    return sectionEndFromHeadings(start, level, view.state.doc.content.size, headingBoundaries)
  }
  const sourceEnd = sectionEnd(sourcePos, Number(source.attrs.level))
  const targetEnd = sectionEnd(targetPos, Number(target.attrs.level))
  const insertAt = sectionMoveInsertion({ start: sourcePos, end: sourceEnd }, { start: targetPos, end: targetEnd })
  if (insertAt === null) return false
  const slice = view.state.doc.slice(sourcePos, sourceEnd)
  const tr = view.state.tr.delete(sourcePos, sourceEnd).insert(insertAt, slice.content)
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

export function headingKeyAt(element: HTMLElement): string | null {
  const heading = element.closest<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6')
  if (!heading) return null
  const view = getEditorView()
  if (!view) return null
  try {
    const pos = view.posAtDOM(heading, 0)
    const $pos = view.state.doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'heading') return String($pos.before(depth))
  } catch {}
  return null
}

let headingControlListenersInstalled = false

function positionHeadingControls(): void {
  const root = document.querySelector<HTMLElement>('#editor .ProseMirror')
  const controls = document.getElementById('colamd-heading-controls')
  if (!root || !controls) return
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
  for (const button of Array.from(controls.querySelectorAll<HTMLButtonElement>('button[data-heading-index]'))) {
    const heading = headings[Number(button.dataset.headingIndex)] ?? null
    if (!heading || heading.classList.contains('colamd-section-hidden')) { button.hidden = true; continue }
    const rect = heading.getBoundingClientRect()
    button.hidden = rect.bottom < 52 || rect.top > window.innerHeight
    button.style.left = `${Math.max(6, rect.left - 31)}px`
    button.style.top = `${rect.top + Math.max(0, (rect.height - 24) / 2)}px`
  }
}

function renderHeadingControls(headings: readonly HTMLHeadingElement[]): void {
  let controls = document.getElementById('colamd-heading-controls') as HTMLDivElement | null
  if (!controls) {
    controls = document.createElement('div')
    controls.id = 'colamd-heading-controls'
    controls.setAttribute('aria-label', t('collapsedSection'))
    document.body.append(controls)
  }
  controls.hidden = false
  controls.replaceChildren()
  for (const [index, heading] of headings.entries()) {
    const key = headingKeyAt(heading)
    if (!key || heading.classList.contains('colamd-section-hidden')) continue
    const collapsed = heading.classList.contains('colamd-heading-collapsed')
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.headingKey = key
    button.dataset.headingIndex = String(index)
    button.className = 'heading-collapse-control'
    button.innerHTML = iconSvg(collapsed ? 'chevronRight' : 'chevronDown', 14)
    button.title = collapsed ? t('expandSection') : t('collapsedSection')
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-expanded', String(!collapsed))
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation() })
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation()
      window.dispatchEvent(new CustomEvent('colamd-toggle-heading-collapse', { detail: key }))
    })
    controls.append(button)
  }
  if (!headingControlListenersInstalled) {
    headingControlListenersInstalled = true
    document.getElementById('editor')?.addEventListener('scroll', positionHeadingControls, { passive: true })
    window.addEventListener('resize', positionHeadingControls, { passive: true })
    window.addEventListener('colamd-layout-changed', positionHeadingControls)
  }
  positionHeadingControls()
  requestAnimationFrame(positionHeadingControls)
}

/** Presentation-only collapse state is reapplied after every document render and never serialized. */
export function applyHeadingCollapse(keys: ReadonlySet<string>): void {
  const view = getEditorView()
  if (!view) return
  const decorations: Decoration[] = []
  let collapsedAncestorLevels: number[] = []
  view.state.doc.forEach((node, position) => {
    const heading = node.type.name === 'heading'
    let hidden = collapsedAncestorLevels.length > 0
    if (heading) {
      const level = Number(node.attrs.level)
      const collapsed = keys.has(String(position))
      // A heading ends every collapsed ancestor at its own level or deeper.
      // Lower-level headings remain descendants and therefore stay hidden.
      const step = collapsedHeadingStep(collapsedAncestorLevels, level, collapsed)
      hidden = step.hidden
      collapsedAncestorLevels = step.ancestors
      if (collapsed) decorations.push(Decoration.node(position, position + node.nodeSize, { class: 'colamd-heading-collapsed' }))
    }
    if (hidden) decorations.push(Decoration.node(position, position + node.nodeSize, { class: 'colamd-section-hidden' }))
  })
  view.dispatch(view.state.tr.setMeta(headingCollapsePluginKey, DecorationSet.create(view.state.doc, decorations)))
  const headings = Array.from(document.querySelectorAll<HTMLHeadingElement>('#editor .ProseMirror h1, #editor .ProseMirror h2, #editor .ProseMirror h3, #editor .ProseMirror h4, #editor .ProseMirror h5, #editor .ProseMirror h6'))
  renderHeadingControls(headings)
}

export function codeBlockKeyAt(element: HTMLElement): string | null {
  const pre = element.closest('pre')
  const view = getEditorView()
  if (!pre || !view) return null
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(pre, 0))
    for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'code_block') return String($pos.before(depth))
  } catch {}
  return null
}

function codeBlockLanguageAt(element: HTMLElement): string {
  const pre = element.closest('pre')
  const view = getEditorView()
  if (pre && view) {
    try {
      const $pos = view.state.doc.resolve(view.posAtDOM(pre, 0))
      for (let depth = $pos.depth; depth > 0; depth--) {
        const node = $pos.node(depth)
        if (node.type.name === 'code_block') return String(node.attrs.language ?? '')
      }
    } catch {}
  }
  // Milkdown normally emits pre[data-language]; the class fallback also keeps
  // controls accurate if a highlighter recreates the code element first.
  const fromData = pre?.dataset.language
  if (fromData) return fromData
  const classes = pre?.querySelector('code')?.className ?? ''
  return /(?:^|\s)(?:language-|lang-)([^\s]+)/.exec(classes)?.[1] ?? ''
}

export function applyCodeWrap(keys: ReadonlySet<string>): void {
  const root = document.querySelector('#editor .ProseMirror')
  if (!root) return
  root.querySelectorAll<HTMLElement>('pre').forEach((pre) => pre.classList.toggle('colamd-code-wrap', Boolean(codeBlockKeyAt(pre) && keys.has(codeBlockKeyAt(pre)!))))
}

function installImageResizeControls(root: HTMLElement): void {
  const frame = document.createElement('div')
  frame.className = 'colamd-image-resizer'
  frame.hidden = true
  const size = document.createElement('span'); size.className = 'colamd-image-size'
  frame.append(size)
  for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const handle = document.createElement('button')
    handle.type = 'button'; handle.className = `colamd-image-resize-handle ${direction}`; handle.dataset.direction = direction; handle.setAttribute('aria-label', 'Resize image')
    frame.append(handle)
  }
  document.body.append(frame)

  let activeImage: HTMLImageElement | null = null
  let dragging = false
  const position = (): void => {
    if (!activeImage || !activeImage.isConnected) { frame.hidden = true; return }
    const rect = activeImage.getBoundingClientRect()
    frame.style.left = `${rect.left}px`; frame.style.top = `${rect.top}px`; frame.style.width = `${rect.width}px`; frame.style.height = `${rect.height}px`
    size.textContent = `${Math.round(rect.width)} px`
  }
  const select = (image: HTMLImageElement): void => { activeImage = image; frame.hidden = false; position() }
  const hide = (): void => { if (!dragging) { frame.hidden = true; activeImage = null } }

  root.addEventListener('mouseover', (event) => {
    const image = (event.target as HTMLElement | null)?.closest<HTMLImageElement>('img')
    if (image) select(image)
  })
  root.addEventListener('scroll', position, { passive: true })
  window.addEventListener('resize', position, { passive: true })
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.colamd-image-resizer') && !target?.closest('#editor .ProseMirror img')) hide()
  }, true)

  frame.addEventListener('pointerdown', (event) => {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.colamd-image-resize-handle')
    if (!handle || !activeImage) return
    event.preventDefault(); event.stopPropagation(); dragging = true
    frame.classList.add('dragging')
    const image = activeImage
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = image.getBoundingClientRect().width
    const startHeight = image.getBoundingClientRect().height
    // Height stays `auto`, so vertical drags are mapped back to width through
    // the aspect ratio to keep corner and edge handles feeling consistent.
    const aspect = startWidth / Math.max(1, startHeight)
    const direction = handle.dataset.direction ?? 'se'
    handle.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent): void => {
      const horizontal = direction.includes('e') ? moveEvent.clientX - startX
        : direction.includes('w') ? startX - moveEvent.clientX
          : 0
      const vertical = (direction.includes('s') ? moveEvent.clientY - startY
        : direction.includes('n') ? startY - moveEvent.clientY
          : 0) * aspect
      const delta = horizontal !== 0 && vertical !== 0 ? Math.max(horizontal, vertical) : horizontal + vertical
      const maxWidth = Math.max(120, root.getBoundingClientRect().width)
      const width = Math.min(maxWidth, Math.max(48, startWidth + delta))
      image.style.width = `${width}px`; image.style.height = 'auto'; position()
    }
    const finish = (upEvent: PointerEvent): void => {
      handle.releasePointerCapture(upEvent.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      dragging = false
      frame.classList.remove('dragging')
      const width = image.getBoundingClientRect().width
      if (!setImageWidthAt(image, width)) image.style.removeProperty('width')
      frame.hidden = true; activeImage = null
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  })
}

function installTableAndCodeTools(root: HTMLElement): void {
  const tableTools = document.createElement('div'); tableTools.className = 'colamd-floating-table-tools'; tableTools.hidden = true
  const tableAlign = document.createElement('div'); tableAlign.className = 'colamd-table-align-tools'
  const tableActions = document.createElement('div'); tableActions.className = 'colamd-table-actions'
  let activeCell: HTMLElement | null = null
  let activeTable: HTMLTableElement | null = null
  let activeTableIndex = 0
  let activeColumnIndex = 0
  const currentTableCell = (): HTMLElement | null => {
    if (!activeTable?.isConnected) activeTable = root.querySelectorAll<HTMLTableElement>('table')[activeTableIndex] ?? null
    if (!activeTable) return activeCell?.isConnected ? activeCell : null
    return activeTable.rows[0]?.cells[activeColumnIndex] ?? activeTable.querySelector('td,th')
  }
  const makeTableButton = (parent: HTMLElement, icon: Parameters<typeof setButtonIcon>[1], title: string, action: () => void, extraClass = '') => {
    const button = document.createElement('button'); button.type = 'button'; setButtonIcon(button, icon, 15); button.title = title; button.setAttribute('aria-label', title)
    if (extraClass) button.className = extraClass
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); action() })
    parent.append(button)
  }
  makeTableButton(tableAlign, 'alignLeft', t('alignLeft'), () => runTableCommand('align-left', currentTableCell()))
  makeTableButton(tableAlign, 'alignCenter', t('alignCenter'), () => runTableCommand('align-center', currentTableCell()))
  makeTableButton(tableAlign, 'alignRight', t('alignRight'), () => runTableCommand('align-right', currentTableCell()))
  makeTableButton(tableActions, 'copy', t('copyTable'), () => {
    if (!activeTable) return
    const text = Array.from(activeTable.rows).map((row) => Array.from(row.cells).map((cell) => cell.innerText.trim()).join('\t')).join('\n')
    void window.electronAPI.copyTable(activeTable.outerHTML, text)
  })
  makeTableButton(tableActions, 'trash', t('deleteTable'), () => runTableCommand('delete-table', currentTableCell()), 'danger')
  const toolsDivider = document.createElement('span'); toolsDivider.className = 'colamd-table-tools-divider'
  tableTools.append(tableAlign, toolsDivider, tableActions); document.body.append(tableTools)

  const copyCode = document.createElement('button'); copyCode.type = 'button'; copyCode.className = 'colamd-code-copy'; setButtonIcon(copyCode, 'copy', 13); copyCode.title = t('copyCode'); copyCode.setAttribute('aria-label', t('copyCode'))
  const codeOptions = document.createElement('div'); codeOptions.className = 'colamd-code-options'; codeOptions.hidden = true
  const language = document.createElement('select'); language.setAttribute('aria-label', t('languageLabel'))
  const wrap = document.createElement('button'); wrap.type = 'button'; setButtonIcon(wrap, 'wrap', 13)
  const syncWrapLabel = (pre: HTMLElement): void => {
    const wrapped = pre.classList.contains('colamd-code-wrap')
    const label = wrapped ? t('unwrapCode') : t('wrapCode')
    wrap.title = label; wrap.setAttribute('aria-label', label); wrap.classList.toggle('active', wrapped)
  }
  // One compact bar in the block corner: language, wrap and copy share a row
  // instead of stacking as separate floating cards over the code.
  codeOptions.append(language, wrap, copyCode); document.body.append(codeOptions)
  let activePre: HTMLElement | null = null

  const positionTable = (): void => {
    if (!activeTable?.isConnected) { tableTools.hidden = true; return }
    const rect = activeTable.getBoundingClientRect()
    const maxLeft = Math.max(8, window.innerWidth - tableTools.offsetWidth - 8)
    tableTools.style.left = `${Math.min(Math.max(8, rect.left), maxLeft)}px`
    tableTools.style.top = `${Math.max(54, rect.top - tableTools.offsetHeight - 6)}px`
  }
  const positionCode = (): void => {
    if (!activePre?.isConnected) { codeOptions.hidden = true; return }
    const rect = activePre.getBoundingClientRect()
    codeOptions.style.left = `${Math.max(8, rect.right - codeOptions.offsetWidth - 8)}px`
    codeOptions.style.top = `${Math.max(56, rect.top + 6)}px`
  }
  const fillLanguages = (current: string): void => {
    language.replaceChildren()
    const values = ['', 'text', 'js', 'ts', 'json', 'python', 'bash', 'sql', 'html', 'css', 'java', 'c', 'cpp', 'rust', 'go']
    if (current && !values.includes(current)) values.push(current)
    for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value || t('languageLabel'); language.append(option) }
    language.value = current
  }
  const showTable = (table: HTMLTableElement, cell: HTMLElement | null): void => {
    activeTable = table
    activeTableIndex = Array.from(root.querySelectorAll<HTMLTableElement>('table')).indexOf(table)
    activeCell = cell ?? table.querySelector('td,th')
    if (activeCell instanceof HTMLTableCellElement) activeColumnIndex = activeCell.cellIndex
    tableTools.hidden = false
    positionTable()
  }
  const showCode = (pre: HTMLElement): void => { activePre = pre; fillLanguages(codeBlockLanguageAt(pre)); syncWrapLabel(pre); copyCode.hidden = false; codeOptions.hidden = false; positionCode() }

  root.addEventListener('mousemove', (event) => {
    const target = event.target as HTMLElement | null
    const table = target?.closest<HTMLTableElement>('table')
    if (table) showTable(table, target?.closest<HTMLElement>('td,th') ?? null)
    const pre = target?.closest<HTMLElement>('pre')
    if (pre) showCode(pre)
  })
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.colamd-floating-table-tools') && !target?.closest('#editor table')) { tableTools.hidden = true; activeTable = null; activeCell = null }
    if (!target?.closest('.colamd-code-copy,.colamd-code-options') && !target?.closest('#editor pre')) { codeOptions.hidden = true; activePre = null }
  }, true)
  root.addEventListener('scroll', () => { positionTable(); positionCode() }, { passive: true })
  window.addEventListener('resize', () => { positionTable(); positionCode() }, { passive: true })

  let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null
  copyCode.addEventListener('click', () => {
    if (!activePre) return
    void navigator.clipboard?.writeText(activePre.querySelector('code')?.textContent ?? activePre.textContent ?? '')
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
    setButtonIcon(copyCode, 'check', 13); copyCode.classList.add('copied')
    copyFeedbackTimer = setTimeout(() => { setButtonIcon(copyCode, 'copy', 13); copyCode.classList.remove('copied'); copyFeedbackTimer = null }, 1200)
  })
  wrap.addEventListener('click', () => { if (!activePre) return; const key = codeBlockKeyAt(activePre); if (key) window.dispatchEvent(new CustomEvent('colamd-toggle-code-wrap', { detail: key })); syncWrapLabel(activePre) })
  language.addEventListener('change', () => {
    const view = getEditorView(); if (!view || !activePre) return
    try {
      const pos = view.posAtDOM(activePre, 0); const $pos = view.state.doc.resolve(pos)
      for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'code_block') { view.dispatch(view.state.tr.setNodeMarkup($pos.before(depth), undefined, { ...$pos.node(depth).attrs, language: language.value })); break }
    } catch {}
  })
}

function changeHeadingLevel(delta: -1 | 1): boolean {
  const view = getEditorView()
  if (!view) return false
  const { nodes } = view.state.schema
  const { $from } = view.state.selection

  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.type === nodes.heading) {
      const level = Number(node.attrs.level)
      if (delta < 0 && level > 1) return runCommand(setBlockType(nodes.heading, { level: level - 1 }))
      if (delta > 0 && level < 6) return runCommand(setBlockType(nodes.heading, { level: level + 1 }))
      if (delta > 0 && level === 6) return runCommand(setBlockType(nodes.paragraph))
      return false
    }
    if (node.type === nodes.paragraph) {
      return delta < 0 ? runCommand(setBlockType(nodes.heading, { level: 6 })) : false
    }
  }
  return false
}

function findListItemPosition(view: EditorView): number | null {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'list_item') return $from.before(depth)
  }
  return null
}

function makeTaskList(): boolean {
  const view = getEditorView()
  if (!view) return false
  let itemPos = findListItemPosition(view)

  if (itemPos === null) {
    const wrapped = wrapInList(view.state.schema.nodes.bullet_list)(view.state, view.dispatch, view)
    if (!wrapped) return false
    itemPos = findListItemPosition(view)
  }

  if (itemPos === null) return false
  const item = view.state.doc.nodeAt(itemPos)
  if (!item) return false
  view.dispatch(view.state.tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked: false }).scrollIntoView())
  view.focus()
  return true
}

const inlineStyles: Record<string, string> = {
  'h1': 'font-size:1.8em;font-weight:700;margin:1em 0 .5em;padding-bottom:.3em;border-bottom:1px solid #eee;',
  'h2': 'font-size:1.4em;font-weight:600;margin:1em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #eee;',
  'h3': 'font-size:1.2em;font-weight:600;margin:.8em 0 .4em;',
  'h4': 'font-weight:600;margin:.8em 0 .4em;',
  'h5': 'font-weight:600;margin:.8em 0 .4em;',
  'h6': 'font-weight:600;margin:.8em 0 .4em;',
  'p': 'margin:.5em 0;line-height:1.75;',
  'strong': 'font-weight:600;',
  'a': 'color:#0969da;text-decoration:none;',
  'code': 'background:rgba(175,184,193,0.2);padding:2px 6px;border-radius:3px;font-size:.875em;font-family:Menlo,Monaco,monospace;',
  'pre': 'background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;margin:1em 0;',
  'blockquote': 'border-left:4px solid #ddd;padding-left:16px;margin:1em 0;color:#666;',
  'ul': 'padding-left:24px;margin:.5em 0;',
  'ol': 'padding-left:24px;margin:.5em 0;',
  'li': 'margin:.25em 0;',
  'table': 'border-collapse:collapse;width:100%;margin:1em 0;',
  'th': 'border:1px solid #ddd;padding:8px 12px;text-align:left;font-weight:600;background:#f6f8fa;',
  'td': 'border:1px solid #ddd;padding:8px 12px;text-align:left;',
  'hr': 'border:none;border-top:2px solid #ddd;margin:2em 0;',
  'img': 'max-width:100%;',
}

function enhanceClipboard(e: ClipboardEvent): void {
  const html = e.clipboardData?.getData('text/html')
  if (!html) return

  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const [tag, style] of Object.entries(inlineStyles)) {
    doc.querySelectorAll(tag).forEach((el) => {
      ;(el as HTMLElement).setAttribute('style', style)
    })
  }

  // pre > code: override code style inside code blocks
  doc.querySelectorAll('pre code').forEach((el) => {
    ;(el as HTMLElement).setAttribute('style', 'background:none;padding:0;font-size:.875em;line-height:1.6;font-family:Menlo,Monaco,monospace;')
  })

  e.clipboardData?.setData('text/html', doc.body.innerHTML)
}

export async function createEditor(
  rootId: string,
  onChange?: (markdown: string) => void
): Promise<Editor> {
  const root = document.getElementById(rootId)
  if (!root) throw new Error(`Element #${rootId} not found`)

  editorInstance = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, t('welcomeMarkdown'))
      ctx.set(remarkPluginsCtx, [
        { plugin: remarkBreaks, options: {} },
        { plugin: remarkHighlight, options: {} },
      ])
      ctx.set(katexOptionsCtx.key, { throwOnError: false })
      // Teach remark-stringify how to emit our custom ==highlight== node
      const stringifyOptions = ctx.get(remarkStringifyOptionsCtx)
      ctx.set(remarkStringifyOptionsCtx, {
        ...stringifyOptions,
        // 'mark' is a custom node type, not part of the typed Handlers map
        handlers: { ...stringifyOptions.handlers, mark: highlightStringifyHandler } as typeof stringifyOptions.handlers,
      })
      if (onChange) {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(normalizeCitationMarkdown(markdown))
        })
      }
    })
    .use(commonmark)
    .use(gfm)
    .use(columnResizingPlugin)
    .use(highlight)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(htmlView)
    .use(imageView)
    .use([
      remarkMathPlugin,
      katexOptionsCtx,
      mathInlineSchema,
      displayMathBlockSchema,
      mathInlineInputRule,
      displayMathBlockInputRule,
    ].flat())
    .use(mathEditorPlugin)
    .use(mermaidPlugin)
    .use(citationMarkPlugin)
    .use(documentChangePlugin)
    .use(headingCollapsePlugin)
    .use(commentMarkPlugin)
    .use(searchHighlight)
    .use(activeBlockPlugin)
    .create()

  // Enhance clipboard with inline styles for rich text paste (e.g. WeChat)
  root.addEventListener('copy', enhanceClipboard)
  root.addEventListener('cut', enhanceClipboard)

  root.addEventListener('paste', (event) => {
    const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'))
    if (!image || !imagePasteHandler) return
    event.preventDefault()
    void imagePasteHandler(image)
  })

  installImageResizeControls(root)
  installTableAndCodeTools(root)
  installCitationHover(root)
  installCitationStoreSync(() => {
    const view = getEditorView()
    if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(citationMarkPluginKey, true))
  })

  // Cmd+click (Mac) / Ctrl+click (Win/Linux) to open links in browser
  root.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (href) {
      e.preventDefault()
      window.electronAPI.openExternal(href)
    }
  })

  // A normal image click previews the already rendered image. Modifier clicks
  // remain available to the link handler above for Cmd/Ctrl+click navigation.
  root.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const image = e.target instanceof HTMLImageElement
      ? e.target.closest<HTMLImageElement>('#editor .ProseMirror img')
      : null
    if (!image) return
    e.preventDefault()
    imageViewer.open({ src: image.currentSrc || image.src, alt: image.alt })
  })

  // Click the checkbox of a task list item to toggle its checked state
  root.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLElement)) return
    const li = e.target.closest('li[data-item-type="task"]') as HTMLElement | null
    if (!li) return
    // Only the checkbox area toggles — clicks on the text still place the cursor
    const rect = li.getBoundingClientRect()
    if (e.clientX - rect.left > 24) return
    e.preventDefault()
    toggleTaskListItem(e)
  })

  // Cmd/Ctrl+Enter toggles the task list item under the cursor
  root.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
    e.preventDefault()
    if (!editorInstance) return
    editorInstance.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const $pos = view.state.doc.resolve(view.state.selection.from)
      for (let d = $pos.depth; d >= 0; d--) {
        const node = $pos.node(d)
        if (node.type.name === 'list_item' && node.attrs.checked != null) {
          const tr = view.state.tr.setNodeMarkup($pos.before(d), undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          })
          view.dispatch(tr)
          return
        }
      }
    })
  })

  return editorInstance
}

function toggleTaskListItem(e: MouseEvent): void {
  if (!editorInstance) return
  editorInstance.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    // posAtDOM(li, 0) lands inside the li (on its first child), not on the
    // list_item node itself — locate by click coordinates instead and walk up
    // the tree, same as the ⌘+Enter path.
    const coords = view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (!coords) return
    const $pos = view.state.doc.resolve(coords.pos)
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'list_item' && node.attrs.checked != null) {
        const tr = view.state.tr.setNodeMarkup($pos.before(d), undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        })
        view.dispatch(tr)
        return
      }
    }
  })
}

export function getMarkdown(): string {
  if (!editorInstance) return ''
  let markdown = ''
  editorInstance.action((ctx) => {
    const serializer = ctx.get(serializerCtx)
    const view = ctx.get(editorViewCtx)
    markdown = normalizeCitationMarkdown(serializer(view.state.doc))
  })
  return markdown
}

export function setMarkdown(content: string): void {
  if (!editorInstance) return
  // A single ProseMirror view is shared by all tabs. Flushing the replacement
  // keeps activation out of normal history so Undo cannot resurrect another
  // tab's document. Within-tab user transactions still retain normal history.
  editorInstance.action(replaceAll(normalizeTyporaBlockMath(content), true))
}

export function getEditorView(): EditorView | null {
  if (!editorInstance) return null
  let view: EditorView | null = null
  editorInstance.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  return view
}

export interface EditorSelectionContext {
  selectedText: string
  from: number
  to: number
  line: number
  heading: string | null
  anchor: { left: number; top: number; bottom: number } | null
}

export function getEditorSelectionContext(markdown = getMarkdown()): EditorSelectionContext {
  const view = getEditorView()
  if (!view) return { selectedText: '', from: 0, to: 0, line: 1, heading: null, anchor: null }
  const { from, to, $from } = view.state.selection
  const selectedText = view.state.doc.textBetween(from, to, '\n', '\n')
  let heading: string | null = null
  for (let position = from; position >= 0;) {
    const resolved = view.state.doc.resolve(position)
    const node = resolved.nodeAfter
    if (node?.type.name === 'heading') { heading = node.textContent; break }
    if (position === 0) break
    position = Math.max(0, position - 1)
  }
  if (!heading) for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'heading') { heading = node.textContent; break }
  }
  const needle = selectedText || view.state.doc.textBetween(Math.max(0, from - 24), from, '\n', '\n')
  const offset = needle ? Math.max(0, markdown.indexOf(needle)) : 0
  let anchor: EditorSelectionContext['anchor'] = null
  try { const coords = view.coordsAtPos(from); anchor = { left: coords.left, top: coords.top, bottom: coords.bottom } } catch {}
  return { selectedText, from, to, line: markdown.slice(0, offset).split('\n').length, heading, anchor }
}

export function revealMarkdownLocation(heading?: string, line?: number): boolean {
  const root = document.getElementById('editor')
  if (!root) return false
  let target: HTMLElement | null = null
  if (heading) target = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].find((element) => element.textContent?.trim() === heading.trim()) ?? null
  if (!target && line && line > 0) {
    const blocks = [...root.querySelectorAll<HTMLElement>('.ProseMirror > *')]
    const ratio = Math.min(1, Math.max(0, (line - 1) / Math.max(1, getMarkdown().split('\n').length - 1)))
    target = blocks[Math.min(blocks.length - 1, Math.round(ratio * Math.max(0, blocks.length - 1)))] ?? null
  }
  if (!target) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target.animate([{ backgroundColor: 'color-mix(in srgb, var(--accent, #146b8c) 24%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 1100 })
  return true
}

// ---------- 批注 / 审阅高亮 ----------

export interface CommentMarkRange { from: number; to: number; kind: 'comment' | 'suggestion' }

export function applyCommentMarks(ranges: CommentMarkRange[]): void {
  const view = getEditorView()
  if (!view) return
  const size = view.state.doc.content.size
  const decorations = ranges
    .filter((range) => range.to > range.from && range.from >= 0 && range.to <= size)
    .map((range) => Decoration.inline(range.from, range.to, { class: `quill-mark quill-mark-${range.kind}` }))
  view.dispatch(view.state.tr.setMeta(commentMarkPluginKey, DecorationSet.create(view.state.doc, decorations)))
}

/**
 * 在 ProseMirror 文档纯文本中定位锚点。
 * 文本节点直接拼接（与 textBetween 默认行为一致），命中后映射回文档位置。
 */
export function locatePlainTextRange(anchor: string, prefix: string, suffix: string): { from: number; to: number } | null {
  const view = getEditorView()
  if (!view || !anchor) return null
  const segments: Array<{ text: string; pos: number }> = []
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, pos })
    return true
  })
  const full = segments.map((segment) => segment.text).join('')
  let best: { from: number; score: number } | null = null
  let index = full.indexOf(anchor)
  while (index !== -1) {
    let score = 1
    if (prefix && full.slice(Math.max(0, index - prefix.length), index) === prefix) score += 2
    if (suffix && full.slice(index + anchor.length, index + anchor.length + suffix.length) === suffix) score += 2
    if (!best || score > best.score) best = { from: index, score }
    index = full.indexOf(anchor, index + 1)
  }
  if (!best) return null
  const mapIndex = (target: number): number => {
    let offset = 0
    for (const segment of segments) {
      if (target <= offset + segment.text.length) return segment.pos + (target - offset)
      offset += segment.text.length
    }
    return view.state.doc.content.size
  }
  return { from: mapIndex(best.from), to: mapIndex(best.from + anchor.length) }
}

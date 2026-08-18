import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { $prose } from '@milkdown/kit/utils'
import mermaid from 'mermaid'
import { getEditorView, openImagePreview } from './editor'
import { t } from '../i18n'
import { iconSvg } from '../icons'
import { mermaidModal } from './mermaid-modal'
import { waitForRenderKeys } from '../mermaid-export'

type RenderResult =
  | { status: 'ok'; svg: string }
  | { status: 'error'; message: string }

type PreviewResult = RenderResult | { status: 'pending' }

const CACHE_LIMIT = 120
const cache = new Map<string, RenderResult>()
const pending = new Map<string, number>()
const activeRenders = new Set<string>()
let renderSeq = 0

function isDarkTheme(): boolean {
  return document.body.classList.contains('theme-dark')
}

function applyMermaidConfig(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDarkTheme() ? 'dark' : 'default',
    // 必须显式指定字体栈：'inherit' 会让 mermaid 的离屏文字测量与
    // 编辑器内实际渲染使用不同字体，导致节点文字被裁掉首字符。
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  })
}

applyMermaidConfig()

function cacheKey(source: string): string {
  return `${isDarkTheme() ? 'dark' : 'light'}\n${source}`
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Mermaid parse errors carry the useful line info at the start; drop the
  // trailing stack/noise so the message fits the small error box.
  const cleaned = raw.split('\n').filter((line) => line.trim().length > 0).slice(0, 4).join('\n')
  return cleaned.length > 240 ? `${cleaned.slice(0, 240)}…` : cleaned
}

function cacheResult(key: string, result: RenderResult): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, result)
}

function notifyRendered(key: string): void {
  window.dispatchEvent(new CustomEvent('quill-mermaid-rendered'))
  refreshLiveWidgets(key)
}

/** 强制重建所有图表 widget（主题切换后 key 随主题变化，需要整批重建）。 */
function forceRebuildWidgets(): void {
  const view = getEditorView()
  if (view && !view.isDestroyed) {
    view.dispatch(view.state.tr.setMeta(mermaidPluginKey, true))
  }
}

/**
 * 渲染完成后就地刷新挂在文档里的 widget。
 * ProseMirror 按 decoration key 复用 DOM——key 由 pos+source 决定，
 * 渲染完成并不会改变 key，所以必须直接更新已挂载的 DOM，
 * 否则 widget 会永远停在“正在渲染”。
 */
function refreshLiveWidgets(key: string): void {
  const selector = `.mermaid-block[data-mkey="${CSS.escape(key)}"]`
  for (const wrap of document.querySelectorAll<HTMLElement>(selector)) {
    const block = locateBlock(wrap)
    if (block) fillWidget(wrap, block.source)
  }
}

function cleanupFailedRenderDom(id: string): void {
  // Mermaid leaves its error bomb graphic in the body on parse failures.
  document.getElementById(id)?.remove()
  document.getElementById(`d${id}`)?.remove()
}

function requestRender(source: string, debounceMs: number): void {
  const key = cacheKey(source)
  if (cache.has(key) || activeRenders.has(key)) return
  const existing = pending.get(key)
  if (existing !== undefined) window.clearTimeout(existing)
  pending.set(key, window.setTimeout(() => {
    pending.delete(key)
    if (cache.has(key) || activeRenders.has(key)) return
    activeRenders.add(key)
    const id = `quill-mermaid-${++renderSeq}`
    mermaid.render(id, source)
      .then(({ svg }) => {
        cacheResult(key, { status: 'ok', svg })
      })
      .catch((error: unknown) => {
        cleanupFailedRenderDom(id)
        cacheResult(key, { status: 'error', message: errorMessage(error) })
      })
      .finally(() => {
        activeRenders.delete(key)
        notifyRendered(key)
      })
  }, debounceMs))
}

/**
 * Shared by the editor widget and the modal preview: returns the cached
 * result when available, otherwise schedules a render and reports 'pending'.
 */
export function renderMermaidPreview(source: string): PreviewResult {
  const key = cacheKey(source)
  const hit = cache.get(key)
  if (hit) return hit
  requestRender(source, 0)
  return { status: 'pending' }
}

/** Ensure every visible Mermaid block has finished rendering before export. */
export async function waitForMermaidRenders(root: HTMLElement, timeoutMs = 8_000): Promise<boolean> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const sources = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
    .map((wrap) => locateBlock(wrap)?.source.trim() ?? '')
    .filter(Boolean)
  const keys = Array.from(new Set(sources.map(cacheKey)))
  for (const source of sources) requestRender(source, 0)
  const settled = await waitForRenderKeys(
    keys,
    (key) => cache.has(key),
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 25)),
    timeoutMs,
  )
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  return settled
}

// Re-render everything when the app theme flips between light and dark.
new MutationObserver(() => {
  applyMermaidConfig()
  cache.clear()
  forceRebuildWidgets()
}).observe(document.body, { attributes: true, attributeFilter: ['class'] })

// ---------------------------------------------------------------------------
// Widget DOM
// ---------------------------------------------------------------------------

function tinyHash(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

/** Locate the mermaid code block that owns a widget via its live DOM position. */
function locateBlock(wrap: HTMLElement): { pos: number; source: string } | null {
  const view = getEditorView()
  if (!view || view.isDestroyed) return null
  try {
    const widgetPos = view.posAtDOM(wrap, 0)
    const resolved = view.state.doc.resolve(Math.max(0, Math.min(widgetPos, view.state.doc.content.size)))
    const before = resolved.nodeBefore
    if (before && before.type.name === 'code_block') {
      const pos = widgetPos - before.nodeSize
      if (String(before.attrs.language ?? '').trim().toLowerCase() === 'mermaid') {
        return { pos, source: before.textContent }
      }
    }
  } catch {
    // The widget is momentarily detached during a re-render; ignore.
  }
  return null
}

function buildWidget(source: string, codeMode: boolean): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'mermaid-block'
  wrap.contentEditable = 'false'
  wrap.dataset.mkey = cacheKey(source)

  const body = document.createElement('div')
  body.className = 'mermaid-body'
  wrap.append(buildToolbar(wrap, codeMode), body)
  fillWidget(wrap, source)

  wrap.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('.mermaid-toolbar')) return
    event.preventDefault()
    event.stopPropagation()
    const block = locateBlock(wrap)
    if (block) mermaidModal.show(block.source, block.pos)
  })
  wrap.addEventListener('contextmenu', (event) => {
    if ((event.target as HTMLElement).closest('.mermaid-toolbar')) return
    event.preventDefault()
    event.stopPropagation()
    const block = locateBlock(wrap)
    if (block) showMermaidMenu(event.clientX, event.clientY, wrap, block)
  })
  return wrap
}

// ---------------------------------------------------------------------------
// Toolbar: Mermaid label + fullscreen / save / copy + code-preview toggle
// ---------------------------------------------------------------------------

/** 按缓存状态填充 widget 内容；渲染完成后也会被 refreshLiveWidgets 调用。 */
function fillWidget(wrap: HTMLElement, source: string): void {
  const body = wrap.querySelector<HTMLElement>('.mermaid-body')
  if (!body) return
  const key = cacheKey(source)
  wrap.dataset.mkey = key
  const result = cache.get(key)
  body.replaceChildren()

  if (!result) {
    const loading = document.createElement('div')
    loading.className = 'mermaid-loading'
    loading.textContent = t('mermaidRendering')
    body.appendChild(loading)
    // Typing inside the block rebuilds the widget each keystroke; debounce so
    // half-finished statements are not rendered over and over.
    requestRender(source, 350)
  } else if (result.status === 'ok') {
    const holder = document.createElement('div')
    holder.className = 'mermaid-diagram'
    holder.innerHTML = result.svg
    body.appendChild(holder)
  } else {
    const error = document.createElement('div')
    error.className = 'mermaid-error'
    const label = document.createElement('div')
    label.className = 'mermaid-error-label'
    label.innerHTML = `${iconSvg('alert', 13)}<span>${t('mermaidError')}</span>`
    const detail = document.createElement('pre')
    detail.className = 'mermaid-error-detail'
    detail.textContent = result.message
    error.append(label, detail)
    body.appendChild(error)
  }

  const hasDiagram = Boolean(result && result.status === 'ok')
  for (const button of wrap.querySelectorAll<HTMLButtonElement>('.mermaid-tool')) {
    button.disabled = !hasDiagram
  }
}

function toolButton(icon: 'expand' | 'download' | 'copy', labelKey: 'mermaidFullscreen' | 'mermaidSave' | 'mermaidCopy', onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mermaid-tool'
  button.title = t(labelKey)
  button.innerHTML = `${iconSvg(icon, 13)}<span>${t(labelKey)}</span>`
  button.addEventListener('pointerdown', (event) => event.stopPropagation())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return button
}

function buildToolbar(wrap: HTMLElement, codeMode: boolean): HTMLElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'mermaid-toolbar'

  const label = document.createElement('span')
  label.className = 'mermaid-toolbar-label'
  label.textContent = 'Mermaid'

  const actions = document.createElement('div')
  actions.className = 'mermaid-toolbar-actions'

  const hasDiagram = () => Boolean(wrap.querySelector('.mermaid-diagram svg'))
  const fullscreen = toolButton('expand', 'mermaidFullscreen', () => fullscreenDiagram(wrap))
  const save = toolButton('download', 'mermaidSave', () => { void saveDiagramPng(wrap) })
  const copy = toolButton('copy', 'mermaidCopy', () => { void copyPng(wrap) })
  for (const button of [fullscreen, save, copy]) button.disabled = !hasDiagram()

  const toggle = document.createElement('div')
  toggle.className = 'mermaid-view-toggle'
  const codeTab = document.createElement('button')
  codeTab.type = 'button'
  codeTab.textContent = t('mermaidCode')
  const previewTab = document.createElement('button')
  previewTab.type = 'button'
  previewTab.textContent = t('mermaidPreview')
  codeTab.classList.toggle('active', codeMode)
  previewTab.classList.toggle('active', !codeMode)
  // 切换即钉住/取消钉住代码模式；点击已激活的一侧不做任何事。
  for (const [tab, mode] of [[codeTab, 'code'], [previewTab, 'preview']] as const) {
    tab.addEventListener('pointerdown', (event) => event.stopPropagation())
    tab.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if ((mode === 'code') === codeMode) return
      const view = getEditorView()
      const block = locateBlock(wrap)
      if (!view || view.isDestroyed || !block) return
      view.dispatch(view.state.tr
        .setMeta(mermaidPluginKey, { toggleCode: block.pos })
        .setMeta('addToHistory', false))
    })
  }
  toggle.append(codeTab, previewTab)

  actions.append(fullscreen, save, copy, toggle)
  toolbar.append(label, actions)
  return toolbar
}

function fullscreenDiagram(wrap: HTMLElement): void {
  const svg = currentSvg(wrap)
  if (!svg) return
  const url = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}`
  openImagePreview(url, 'Mermaid')
}

// ---------------------------------------------------------------------------
// Context menu: edit source / copy SVG / copy PNG
// ---------------------------------------------------------------------------

let activeMenu: HTMLDivElement | null = null

function closeMermaidMenu(): void {
  activeMenu?.remove()
  activeMenu = null
  window.removeEventListener('pointerdown', onMenuOutside, true)
  window.removeEventListener('keydown', onMenuEscape, true)
}

function onMenuOutside(event: PointerEvent): void {
  if (activeMenu && !activeMenu.contains(event.target as Node)) closeMermaidMenu()
}

function onMenuEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMermaidMenu()
}

function menuButton(icon: 'code' | 'copy' | 'download', label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'popover-item'
  button.innerHTML = `${iconSvg(icon, 14)}<span></span>`
  button.querySelector('span')!.textContent = label
  button.addEventListener('click', () => {
    closeMermaidMenu()
    onClick()
  })
  return button
}

function showMiniToast(message: string): void {
  const toast = document.createElement('div')
  toast.className = 'mermaid-toast'
  toast.textContent = message
  document.body.appendChild(toast)
  window.setTimeout(() => toast.classList.add('visible'), 16)
  window.setTimeout(() => {
    toast.classList.remove('visible')
    window.setTimeout(() => toast.remove(), 200)
  }, 1400)
}

function currentSvg(wrap: HTMLElement): string | null {
  return wrap.querySelector('.mermaid-diagram svg')?.outerHTML ?? null
}

async function copySvg(wrap: HTMLElement): Promise<void> {
  const svg = currentSvg(wrap)
  if (!svg) return
  await navigator.clipboard.writeText(svg)
  showMiniToast(t('mermaidCopied'))
}

/** SVG → 2x PNG 字节（画布/svg 管线尽力而为，失败返回 null）。 */
async function rasterizePng(wrap: HTMLElement): Promise<Uint8Array | null> {
  const svg = currentSvg(wrap)
  if (!svg) return null
  const svgElement = wrap.querySelector<SVGSVGElement>('.mermaid-diagram svg')
  const box = svgElement?.viewBox.baseVal
  const width = Math.max(1, Math.ceil((box && box.width) || svgElement?.clientWidth || 640))
  const height = Math.max(1, Math.ceil((box && box.height) || svgElement?.clientHeight || 480))
  const scale = 2
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('svg decode failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || (isDarkTheme() ? '#0d1117' : '#ffffff')
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function copyPng(wrap: HTMLElement): Promise<void> {
  const bytes = await rasterizePng(wrap)
  if (!bytes) return
  const copied = await window.electronAPI.copyImageBytes(bytes, 'image/png')
  if (copied) showMiniToast(t('mermaidCopied'))
}

async function saveDiagramPng(wrap: HTMLElement): Promise<void> {
  const bytes = await rasterizePng(wrap)
  if (!bytes) return
  const saved = await window.electronAPI.saveImageBytes(bytes, 'image/png', 'mermaid-diagram')
  if (saved) showMiniToast(t('mermaidSaved'))
}

async function saveDiagramSvg(wrap: HTMLElement): Promise<void> {
  const svg = currentSvg(wrap)
  if (!svg) return
  const bytes = new TextEncoder().encode(svg)
  const saved = await window.electronAPI.saveImageBytes(bytes, 'image/svg+xml', 'mermaid-diagram')
  if (saved) showMiniToast(t('mermaidSaved'))
}

function showMermaidMenu(x: number, y: number, wrap: HTMLElement, block: { pos: number; source: string }): void {
  closeMermaidMenu()
  const menu = document.createElement('div')
  menu.className = 'popover-menu mermaid-menu'
  const hasDiagram = Boolean(wrap.querySelector('.mermaid-diagram svg'))
  menu.appendChild(menuButton('code', t('mermaidEdit'), () => mermaidModal.show(block.source, block.pos)))
  const svgButton = menuButton('copy', t('mermaidCopySvg'), () => { void copySvg(wrap) })
  const pngButton = menuButton('copy', t('mermaidCopyPng'), () => { void copyPng(wrap) })
  const saveSvgButton = menuButton('download', t('mermaidSaveSvg'), () => { void saveDiagramSvg(wrap) })
  const savePngButton = menuButton('download', t('mermaidSavePng'), () => { void saveDiagramPng(wrap) })
  for (const button of [svgButton, pngButton, saveSvgButton, savePngButton]) button.disabled = !hasDiagram
  menu.append(svgButton, pngButton, saveSvgButton, savePngButton)
  document.body.appendChild(menu)
  activeMenu = menu

  // Flip toward the window interior near edges (same rule as the main menus).
  const margin = 8
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const left = x + width > window.innerWidth - margin ? Math.max(margin, x - width) : x
  const top = y + height > window.innerHeight - margin ? Math.max(margin, y - height) : y
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`

  window.addEventListener('pointerdown', onMenuOutside, true)
  window.addEventListener('keydown', onMenuEscape, true)
}

// ---------------------------------------------------------------------------
// ProseMirror plugin: render a widget under every ```mermaid code block
// ---------------------------------------------------------------------------

interface MermaidPluginState {
  deco: DecorationSet
  /** 钉住“代码”模式的代码块起始位置（随事务映射）。 */
  codeVisible: ReadonlySet<number>
}

export const mermaidPluginKey = new PluginKey<MermaidPluginState>('mermaid-diagrams')

function isMermaidBlock(node: PMNode): boolean {
  return node.type.name === 'code_block' && String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid'
}

function computeDecorations(state: EditorState, codeVisible: ReadonlySet<number>): DecorationSet {
  const decorations: Decoration[] = []
  const { from, to } = state.selection
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      if (isMermaidBlock(node) && node.textContent.trim()) {
        const source = node.textContent
        const end = pos + node.nodeSize
        const selectionInside = from < end && to > pos
        const pinned = codeVisible.has(pos)
        // 默认只显示渲染图；源码仅在钉住“代码”模式或光标进入块内时出现。
        if (!pinned && !selectionInside) {
          decorations.push(Decoration.node(pos, end, { class: 'mermaid-source-collapsed' }))
        }
        decorations.push(Decoration.widget(end, () => buildWidget(source, pinned), {
          side: 1,
          key: `mermaid-${pos}-${tinyHash(source)}-${pinned ? 'code' : 'preview'}`,
        }))
      }
      return false
    }
    return true
  })
  return DecorationSet.create(state.doc, decorations)
}

export const mermaidPlugin = $prose(() => new Plugin({
  key: mermaidPluginKey,
  state: {
    init: (_, state) => ({ deco: computeDecorations(state, new Set()), codeVisible: new Set<number>() }),
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(mermaidPluginKey) as { toggleCode?: number } | true | undefined
      let codeVisible = value.codeVisible
      if (meta && typeof meta === 'object' && typeof meta.toggleCode === 'number') {
        const next = new Set(codeVisible)
        if (next.has(meta.toggleCode)) next.delete(meta.toggleCode)
        else next.add(meta.toggleCode)
        codeVisible = next
      } else if (tr.docChanged && codeVisible.size) {
        const next = new Set<number>()
        for (const pos of codeVisible) next.add(tr.mapping.map(pos, 1))
        codeVisible = next
      }
      // 选区变化也要重算：光标进入/离开代码块决定源码是否自动显现。
      if (tr.docChanged || tr.selectionSet || meta) {
        return { deco: computeDecorations(state, codeVisible), codeVisible }
      }
      return { deco: value.deco.map(tr.mapping, tr.doc), codeVisible }
    },
  },
  props: {
    decorations(state) {
      return mermaidPluginKey.getState(state)?.deco ?? DecorationSet.empty
    },
  },
}))

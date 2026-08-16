import {
  applyCommentMarks,
  applyHeadingCollapse,
  applyCodeWrap,
  clearSlashQuery,
  createEditor,
  getEditorView,
  getEditorSelectionContext,
  getMarkdown,
  getSlashQuery,
  imageMarkdownSourceAt,
  insertImageMarkdown,
  insertParagraphNearSelection,
  insertTable,
  isManagedRelativeImageSource,
  isImageViewerOpen,
  locatePlainTextRange,
  moveHeadingSection,
  runFormattingCommand,
  runTableCommand,
  revealMarkdownLocation,
  setImageWidthAt,
  setImagePasteHandler,
  setMarkdown,
  showMathModal,
  type CommentMarkRange,
} from './editor/editor'
import {
  addComment,
  addSuggestions,
  contextAround,
  deleteComment,
  ensureAnnotations,
  flushAnnotations,
  getAnnotations,
  locateAnchor,
  makeAnnotationId,
  onAnnotationsChanged,
  setCommentResolved,
  setSuggestionStatus,
  type AnnotationSuggestion,
} from './annotations'
import { SearchPanel } from './editor/search-panel'
import { applyTheme, loadSavedTheme } from './themes/theme-manager'
import { setRendererLanguage, t } from './i18n'
import { OutlinePanel } from './outline-panel'
import { CommandRegistry } from './command-registry'
import { authoritativeContent, mirrorWysiwygToSource } from './split-sync'
import { nextEditVersion, remainsDirtyAfterSave } from './document-save'
import { aggregateCloseCanComplete } from './close-save'
import { conflictTargetToCancel } from './conflict-routing'
import { buildExportDocument } from './export-document'
import { markdownSectionAtLine, sourceSelectionContext } from './codex-context'
import { iconSvg, setButtonIcon, type IconName } from './icons'
import type { CodexSendKind, DiskRevision, DocumentPayload, ExportFormat, RecentFile } from '../preload/index'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../shared/settings'
import './themes/base.css'

type EditorMode = 'wysiwyg' | 'source' | 'split'
type SidePanelTab = 'files' | 'outline' | 'tasks'
type ReviewFilter = 'open' | 'resolved' | 'all'

interface ExternalState { content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string; pathChanged?: boolean }
interface DocumentSession {
  documentId: string
  path: string | null
  displayName: string
  content: string
  lastSavedContent: string
  revision: DiskRevision | null
  deleted: boolean
  dirty: boolean
  conflict: ExternalState | null
  forceOverwrite: boolean
  mode: EditorMode
  sourceScroll: number
  editorScroll: number
  collapsedHeadings: Set<string>
  codeWrap: Set<string>
  autosaveTimer: ReturnType<typeof setTimeout> | null
  editVersion: number
  saveTail: Promise<boolean>
  pendingSaveTarget: string | null
  pendingSaveTargetKey: string | null
  closing: boolean
}

const sessions = new Map<string, DocumentSession>()
let activeDocumentId: string | null = null
let applyingDocument = false
let pendingProgrammaticMarkdown: { documentId: string; markdown: string | null } | null = null
let splitRenderFrame: number | null = null
let splitRenderDocumentId: string | null = null
let sourceSyncing = false
let autosaveEnabled = localStorage.getItem('colamd-autosave') === '1'
let appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, autosave: autosaveEnabled, theme: loadSavedTheme() }
let manualPanelHidden = localStorage.getItem('file-panel-hidden') === '1'
let activePanelTab: SidePanelTab = (localStorage.getItem('file-panel-tab') as SidePanelTab) || 'files'
let reviewFilter: ReviewFilter = 'open'
let reviewMode = localStorage.getItem('colamd-review-mode') === '1'
let reviewMarksFrame: number | null = null
let outlinePanel: OutlinePanel | null = null
let outlineFrame: number | null = null
let statusFrame: number | null = null
let taskFrame: number | null = null
let longPaintFrame: number | null = null
let recent: RecentFile[] = []
let windowCloseSaveInProgress = false
let visibleConflictDocumentId: string | null = null
let codexConnected = false
let codexDiffPending = false
let lastCodexSelectionSurface: 'wysiwyg' | 'source' = 'wysiwyg'
let codexToastTimer: ReturnType<typeof setTimeout> | null = null
let dismissActiveCodexProposal: ((decision: 'accepted' | 'rejected') => void) | null = null
const LONG_DOCUMENT_CHAR_THRESHOLD = 100_000
const LONG_DOCUMENT_LINE_THRESHOLD = 1_200

const editorEl = () => document.getElementById('editor') as HTMLElement
const sourceEl = () => document.getElementById('source-editor') as HTMLTextAreaElement
const panelEl = () => document.getElementById('file-panel') as HTMLElement
const tabsEl = () => document.getElementById('document-tabs') as HTMLElement
const recentButtonEl = () => document.getElementById('recent-files-btn') as HTMLButtonElement
const recentMenuEl = () => document.getElementById('recent-files-menu') as HTMLElement
const fileListEl = () => document.getElementById('file-list') as HTMLElement
const statusWordsEl = () => document.getElementById('status-words') as HTMLElement
const statusCharactersEl = () => document.getElementById('status-characters') as HTMLElement
const statusLinesEl = () => document.getElementById('status-lines') as HTMLElement
const conflictBannerEl = () => document.getElementById('conflict-banner') as HTMLElement
const conflictDiffEl = () => document.getElementById('conflict-diff') as HTMLElement
const codexButtonEl = () => document.getElementById('codex-btn') as HTMLButtonElement
const codexMenuEl = () => document.getElementById('codex-menu') as HTMLElement
const codexStatusEl = () => document.getElementById('codex-connection-status') as HTMLElement
const fullscreenBarEl = () => document.getElementById('fullscreen-menu-bar') as HTMLElement
const fullscreenViewButtonEl = () => document.getElementById('fullscreen-view-btn') as HTMLButtonElement
const fullscreenViewMenuEl = () => document.getElementById('fullscreen-view-menu') as HTMLElement
const settingsOverlayEl = () => document.getElementById('settings-overlay') as HTMLElement
const activeSession = (): DocumentSession | null => activeDocumentId ? sessions.get(activeDocumentId) ?? null : null

const editorFontValues: Record<AppSettings['editorFont'], string> = {
  theme: '',
  sans: "var(--font-ui)",
  serif: "'LXGW WenKai', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
  mono: "var(--font-mono)",
}
const contentWidths: Record<AppSettings['contentWidth'], string> = { compact: '680px', comfortable: '780px', wide: '980px', fluid: 'none' }

function applyAppSettings(next: AppSettings): void {
  appSettings = next
  autosaveEnabled = next.autosave
  localStorage.setItem('colamd-autosave', autosaveEnabled ? '1' : '0')
  document.body.classList.toggle('codex-enabled', next.codexEnabled)
  document.body.classList.toggle('show-status-bar', next.statusBar)
  codexButtonEl().hidden = !next.codexEnabled
  codexStatusEl().hidden = !next.codexEnabled
  if (!next.codexEnabled) {
    codexMenuEl().hidden = true
    codexButtonEl().setAttribute('aria-expanded', 'false')
    ;(document.getElementById('codex-toast') as HTMLElement).hidden = true
    dismissActiveCodexProposal?.('rejected')
  }
  document.documentElement.style.setProperty('--editor-font-size', `${next.fontSize}px`)
  document.documentElement.style.setProperty('--editor-line-height', String(next.lineHeight))
  document.documentElement.style.setProperty('--editor-content-width', contentWidths[next.contentWidth])
  if (next.editorFont === 'theme') document.body.removeAttribute('data-editor-font')
  else document.body.setAttribute('data-editor-font', next.editorFont)
  document.documentElement.style.setProperty('--editor-font-override', editorFontValues[next.editorFont] || 'inherit')
  renderAutosave()
  syncSettingsControls()
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('colamd-layout-changed')))
}

async function applyThemeSetting(theme: string): Promise<void> {
  if (theme.startsWith('custom:')) {
    const css = await window.electronAPI.loadThemeCSS(theme.slice(7))
    applyTheme(theme, css ?? undefined)
  } else applyTheme(theme)
}

const builtinThemes = ['elegant', 'light', 'dark', 'newsprint']

function ensureThemeCards(): HTMLButtonElement[] {
  const host = document.getElementById('settings-theme-cards') as HTMLElement | null
  if (!host) return []
  const ids = [...builtinThemes]
  if (appSettings.theme.startsWith('custom:')) ids.push(appSettings.theme)
  const cards: HTMLButtonElement[] = []
  for (const id of ids) {
    let card = host.querySelector<HTMLButtonElement>(`.settings-theme-card[data-theme-id="${CSS.escape(id)}"]`)
    if (!card) {
      card = document.createElement('button')
      card.type = 'button'
      card.className = 'settings-theme-card'
      card.dataset.themeId = id
      card.setAttribute('role', 'radio')
      const preview = document.createElement('span')
      preview.className = 'theme-preview'
      preview.dataset.themePreview = id.startsWith('custom:') ? 'custom' : id
      preview.innerHTML = '<i class="tp-title"></i><i class="tp-line"></i><i class="tp-line short"></i>'
      const name = document.createElement('span')
      name.className = 'theme-name'
      card.append(preview, name)
      card.addEventListener('click', () => { void updateSettings({ theme: id }) })
      host.appendChild(card)
    }
    const label = id.startsWith('custom:') ? id.slice(7) : t(id as 'elegant' | 'light' | 'dark' | 'newsprint')
    ;(card.querySelector('.theme-name') as HTMLElement).textContent = label
    card.setAttribute('aria-label', label)
    cards.push(card)
  }
  for (const card of [...host.querySelectorAll<HTMLElement>('.settings-theme-card')]) {
    if (!ids.includes(card.dataset.themeId!)) card.remove()
  }
  return cards
}

function syncSettingsControls(): void {
  const controls = {
    font: document.getElementById('settings-font') as HTMLSelectElement | null,
    fontSize: document.getElementById('settings-font-size') as HTMLInputElement | null,
    lineHeight: document.getElementById('settings-line-height') as HTMLInputElement | null,
    width: document.getElementById('settings-width') as HTMLSelectElement | null,
    autosave: document.getElementById('settings-autosave') as HTMLInputElement | null,
    statusBar: document.getElementById('settings-statusbar') as HTMLInputElement | null,
    codex: document.getElementById('settings-codex') as HTMLInputElement | null,
  }
  if (!controls.font) return
  for (const card of ensureThemeCards()) {
    const active = card.dataset.themeId === appSettings.theme
    card.classList.toggle('active', active)
    card.setAttribute('aria-checked', String(active))
  }
  controls.font.value = appSettings.editorFont
  controls.fontSize!.value = String(appSettings.fontSize)
  controls.lineHeight!.value = String(appSettings.lineHeight)
  controls.width!.value = appSettings.contentWidth
  controls.autosave!.checked = appSettings.autosave
  controls.statusBar!.checked = appSettings.statusBar
  controls.codex!.checked = appSettings.codexEnabled
  ;(document.getElementById('settings-font-size-value') as HTMLOutputElement).value = `${appSettings.fontSize} px`
  ;(document.getElementById('settings-line-height-value') as HTMLOutputElement).value = appSettings.lineHeight.toFixed(2)
}

async function refreshFileAssociationStatus(): Promise<void> {
  const section = document.getElementById('settings-files-section') as HTMLElement
  const navItem = document.getElementById('settings-nav-files') as HTMLElement | null
  const statusElement = document.getElementById('settings-default-app-status') as HTMLElement
  statusElement.textContent = t('checkingDefaultApp')
  try {
    const status = await window.electronAPI.getFileAssociationStatus()
    section.hidden = !status.supported
    if (navItem) navItem.hidden = !status.supported
    if (!status.supported) return
    statusElement.textContent = status.isDefault
      ? t('defaultAppActive')
      : status.mdDefault || status.markdownDefault
        ? t('defaultAppPartial')
        : t('defaultAppInactive')
  } catch {
    section.hidden = true
    if (navItem) navItem.hidden = true
  }
}

function openSettings(): void {
  hideMenus()
  syncSettingsControls()
  settingsOverlayEl().hidden = false
  const activeCard = document.querySelector<HTMLElement>('.settings-theme-card.active') ?? document.querySelector<HTMLElement>('.settings-theme-card')
  activeCard?.focus()
  void refreshFileAssociationStatus()
}
function closeSettings(): void { settingsOverlayEl().hidden = true }
function makeDialogDraggable(handle: HTMLElement, card: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const rect = card.getBoundingClientRect()
    card.style.position = 'absolute'
    card.style.left = `${rect.left}px`
    card.style.top = `${rect.top}px`
    card.style.margin = '0'
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    const onMove = (ev: PointerEvent) => {
      const x = Math.min(Math.max(ev.clientX - offsetX, 8), window.innerWidth - rect.width - 8)
      const y = Math.min(Math.max(ev.clientY - offsetY, 8), window.innerHeight - rect.height - 8)
      card.style.left = `${x}px`
      card.style.top = `${y}px`
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  })
}
async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const next = await window.electronAPI.updateAppSettings(patch)
  applyAppSettings(next)
  if (patch.theme) await applyThemeSetting(next.theme)
  if (patch.autosave === true) for (const session of sessions.values()) scheduleAutosave(session)
  if (patch.autosave === false) for (const session of sessions.values()) { if (session.autosaveTimer) clearTimeout(session.autosaveTimer); session.autosaveTimer = null }
}

function setFullscreenUi(enabled: boolean): void {
  document.body.classList.toggle('fullscreen-mode', enabled)
  fullscreenBarEl().hidden = !enabled
  if (!enabled) {
    fullscreenViewMenuEl().hidden = true
    fullscreenViewButtonEl().setAttribute('aria-expanded', 'false')
  }
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('colamd-layout-changed')))
}

function updateCodexChrome(): void {
  const button = codexButtonEl()
  const status = codexStatusEl()
  const badge = document.getElementById('codex-diff-badge') as HTMLElement
  const label = codexDiffPending ? t('codexDiffPending') : codexConnected ? t('codexConnected') : t('codexDisconnected')
  button.classList.toggle('connected', codexConnected)
  button.classList.toggle('disconnected', !codexConnected)
  button.classList.toggle('pending', codexDiffPending)
  button.title = label
  badge.hidden = !codexDiffPending
  status.classList.toggle('connected', codexConnected && !codexDiffPending)
  status.classList.toggle('disconnected', !codexConnected && !codexDiffPending)
  status.classList.toggle('pending', codexDiffPending)
  ;(status.querySelector('b') as HTMLElement).textContent = label
}

function setCodexConnected(connected: boolean): void { codexConnected = connected; updateCodexChrome(); if (!codexMenuEl().hidden) renderCodexMenu() }
function setCodexDiffPending(pending: boolean): void { codexDiffPending = pending; updateCodexChrome(); if (!codexMenuEl().hidden) renderCodexMenu() }

function showCodexToast(message: string): void {
  const toast = document.getElementById('codex-toast') as HTMLElement
  if (codexToastTimer) clearTimeout(codexToastTimer)
  toast.textContent = message
  toast.hidden = false
  codexToastTimer = setTimeout(() => { toast.hidden = true; codexToastTimer = null }, 3200)
}

function currentCodexSelectionContext(session: DocumentSession): { selectedText: string; line: number; heading: string | null } {
  const useSource = session.mode === 'source' || (session.mode === 'split' && lastCodexSelectionSurface === 'source')
  return useSource
    ? { ...sourceSelectionContext(session.content, sourceEl().selectionStart, sourceEl().selectionEnd), heading: null }
    : getEditorSelectionContext(session.content)
}

async function sendCodexContext(kind: CodexSendKind): Promise<void> {
  const session = activeSession()
  if (!session) { showCodexToast(t('codexNoDocument')); return }
  snapshotActive()
  const selection = currentCodexSelectionContext(session)
  if (kind === 'selection' && !selection.selectedText.trim()) { showCodexToast(t('codexNoSelection')); return }
  const section = markdownSectionAtLine(session.content, selection.line)
  const result = await window.electronAPI.sendToCodex({
    kind, path: session.path, displayName: session.displayName,
    selectedText: kind === 'selection' ? selection.selectedText : undefined,
    sectionText: kind === 'section' ? section.content : undefined,
    heading: section.heading ?? selection.heading, line: selection.line,
  })
  showCodexToast(result.copied ? t('codexPasteHint') : kind === 'selection' ? t('codexNoSelection') : t('codexNoDocument'))
}

function renderCodexMenu(): void {
  const menu = codexMenuEl(); menu.replaceChildren()
  const status = document.createElement('div'); status.className = `codex-menu-status${codexConnected ? ' connected' : ''}`; status.textContent = codexConnected ? t('codexConnected') : t('codexDisconnected'); menu.append(status)
  const selection = activeSession() ? currentCodexSelectionContext(activeSession()!).selectedText.trim() : ''
  const entries: Array<[CodexSendKind, string, boolean]> = [
    ['selection', t('codexSendSelection'), Boolean(selection)],
    ['section', t('codexSendSection'), Boolean(activeSession())],
    ['document', t('codexCheckDocument'), Boolean(activeSession())],
  ]
  for (const [kind, label, enabled] of entries) {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem'; button.dataset.kind = kind; button.textContent = label; button.disabled = !enabled
    button.addEventListener('click', () => { hideMenus(); void sendCodexContext(kind) }); menu.append(button)
  }
  if (codexDiffPending) { const pending = document.createElement('span'); pending.textContent = `${t('codexDiffPending')} · ${t('codexDiffSafe')}`; menu.append(pending) }
}

function toggleCodexMenu(): void {
  const menu = codexMenuEl(); const button = codexButtonEl()
  if (!menu.hidden) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); return }
  hideMenus(); renderCodexMenu(); button.setAttribute('aria-expanded', 'true')
  const rect = button.getBoundingClientRect(); showMenu(menu, rect.right - 244, rect.bottom + 5)
}

type CodexDiffLine = { kind: 'ctx' | 'del' | 'add'; text: string }

/** Minimal line LCS so proposals read as red removed / green added rows. */
function codexDiffLines(before: string, after: string): CodexDiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // Pathological inputs fall back to a plain before/after dump.
  if (a.length * b.length > 250000) {
    return [...a.map((text): CodexDiffLine => ({ kind: 'del', text })), ...b.map((text): CodexDiffLine => ({ kind: 'add', text }))]
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: CodexDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'ctx', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: 'del', text: a[i] }); i++ }
    else { out.push({ kind: 'add', text: b[j] }); j++ }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++] })
  while (j < b.length) out.push({ kind: 'add', text: b[j++] })
  return out
}

function bridgeProposal(requestId: string, payload: Record<string, unknown>): void {
  dismissActiveCodexProposal?.('rejected')
  const session = activeSession()
  if (!session || (typeof payload.path === 'string' && session.path?.toLocaleLowerCase() !== payload.path.toLocaleLowerCase())) {
    window.electronAPI.respondCodexBridge(requestId, null, 'The proposed document is not active in QuillMesh.')
    return
  }
  const edits = Array.isArray(payload.edits)
    ? payload.edits.filter((item): item is { search: string; replacement: string } => Boolean(item && typeof item === 'object' && typeof (item as any).search === 'string' && typeof (item as any).replacement === 'string'))
    : [{ search: typeof payload.search === 'string' ? payload.search : '', replacement: typeof payload.replacement === 'string' ? payload.replacement : '' }]
  if (!edits.length || edits.some((edit) => !edit.search || !session.content.includes(edit.search))) {
    window.electronAPI.respondCodexBridge(requestId, null, 'The source text no longer matches the open document.')
    return
  }
  // Codex 提案同时登记为审阅建议：先记 pending，接受/拒绝后更新状态并保留记录。
  const proposalTitle = typeof payload.title === 'string' ? payload.title : t('codexProposalTitle')
  const pendingSuggestions: AnnotationSuggestion[] = edits.map((edit) => {
    const located = locateAnchor(session.content, edit.search, '', '')
    const context = located ? contextAround(session.content, located.from, located.to) : { prefix: '', suffix: '' }
    return {
      id: makeAnnotationId('s'), anchor: edit.search, prefix: context.prefix, suffix: context.suffix,
      replacement: edit.replacement, title: proposalTitle, source: 'codex', status: 'pending', createdAt: Date.now(),
    }
  })
  addSuggestions(session.documentId, pendingSuggestions)
  const panel = document.createElement('section')
  panel.id = 'codex-diff-popover'; panel.className = 'codex-diff-popover'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false')

  const header = document.createElement('header'); header.className = 'codex-diff-header'
  const titleRow = document.createElement('div'); titleRow.className = 'codex-diff-title-row'
  titleRow.innerHTML = iconSvg('sparkle', 15)
  const title = document.createElement('strong'); title.textContent = typeof payload.title === 'string' ? payload.title : t('codexProposalTitle')
  titleRow.append(title)
  const chip = document.createElement('span'); chip.className = 'codex-diff-chip'
  header.append(titleRow, chip)

  const body = document.createElement('div'); body.className = 'codex-diff-body'
  edits.forEach((edit, index) => {
    const lines = codexDiffLines(edit.search, edit.replacement)
    const added = lines.filter((line) => line.kind === 'add').length
    const removed = lines.filter((line) => line.kind === 'del').length
    const item = document.createElement('details'); item.className = 'codex-diff-edit'; item.open = true
    const summary = document.createElement('summary')
    summary.innerHTML = `${iconSvg('chevronDown', 13)}<span class="codex-diff-edit-name">${t('codexEditLabel')} ${index + 1}</span><span class="codex-diff-stats"><b class="add">+${added}</b><b class="del">−${removed}</b></span>`
    const list = document.createElement('div'); list.className = 'codex-diff-lines'
    for (const line of lines) {
      const row = document.createElement('div'); row.className = `codex-diff-line ${line.kind}`
      const sign = document.createElement('span'); sign.className = 'codex-diff-sign'; sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '
      const text = document.createElement('span'); text.className = 'codex-diff-text'; text.textContent = line.text || ' '
      row.append(sign, text); list.append(row)
    }
    item.append(summary, list); body.append(item)
  })

  const footer = document.createElement('footer'); footer.className = 'codex-diff-footer'
  const hint = document.createElement('span'); hint.className = 'codex-diff-hint'; hint.textContent = t('codexDiffShortcuts')
  const actions = document.createElement('div'); actions.className = 'codex-diff-actions'
  const reject = document.createElement('button'); reject.type = 'button'; reject.className = 'ghost'; reject.textContent = t('codexReject')
  const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'primary'; accept.textContent = t('codexAccept'); accept.disabled = session.dirty
  actions.append(reject, accept); footer.append(hint, actions)
  panel.append(header, body, footer); document.body.appendChild(panel)

  const updateChip = (): void => {
    if (session.dirty) { chip.className = 'codex-diff-chip warning'; chip.textContent = t('codexDirtyBlock') }
    else { chip.className = 'codex-diff-chip ok'; chip.textContent = `${t('codexRevisionVerified')} · ${t('codexWriteAfterAccept')}` }
  }
  updateChip()
  const markChanged = (): void => { chip.className = 'codex-diff-chip changed'; chip.textContent = t('codexDocChanged') }
  window.addEventListener('colamd-document-changed', markChanged)
  setCodexDiffPending(true)
  const anchor = getEditorSelectionContext(session.content).anchor
  if (anchor) { panel.style.left = `${Math.max(16, Math.min(window.innerWidth - 560, anchor.left))}px`; panel.style.top = `${Math.max(70, Math.min(window.innerHeight - 360, anchor.bottom + 8))}px` }
  let finished = false
  const finish = (decision: 'accepted' | 'rejected'): void => {
    if (finished) return
    finished = true
    document.removeEventListener('keydown', reviewKeys, true)
    window.removeEventListener('colamd-document-changed', markChanged)
    panel.remove()
    if (dismissActiveCodexProposal === finish) dismissActiveCodexProposal = null
    setCodexDiffPending(false)
    for (const suggestion of pendingSuggestions) setSuggestionStatus(session.documentId, suggestion.id, decision)
    window.electronAPI.respondCodexBridge(requestId, { decision, documentId: session.documentId, path: session.path, revision: session.revision?.value ?? null })
  }
  dismissActiveCodexProposal = finish
  const reviewKeys = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); finish('rejected') }
    else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !accept.disabled) { event.preventDefault(); finish('accepted') }
  }
  reject.addEventListener('click', () => finish('rejected'))
  accept.addEventListener('click', () => finish('accepted'))
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); finish('rejected') } })
  document.addEventListener('keydown', reviewKeys, true)
  requestAnimationFrame(() => (accept.disabled ? reject : accept).focus())
}

function handleCodexBridgeRequest(request: import('../preload/index').CodexBridgeRequest): void {
  if (!appSettings.codexEnabled) { window.electronAPI.respondCodexBridge(request.requestId, null, 'Codex integration is disabled in QuillMesh settings.'); return }
  const { requestId, action, payload } = request
  try {
    if (action === 'proposal') { bridgeProposal(requestId, payload); return }
    const session = activeSession()
    if (action === 'context') {
      if (!session) { window.electronAPI.respondCodexBridge(requestId, { active: false }); return }
      window.electronAPI.respondCodexBridge(requestId, {
        active: true, documentId: session.documentId, path: session.path, displayName: session.displayName,
        revision: session.revision?.value ?? null, dirty: session.dirty, mode: session.mode, content: session.content,
        selection: getEditorSelectionContext(session.content),
      })
      return
    }
    if (!session) throw new Error('No active document.')
    if (action === 'locate') {
      requestAnimationFrame(() => window.electronAPI.respondCodexBridge(requestId, { located: revealMarkdownLocation(typeof payload.heading === 'string' ? payload.heading : undefined, typeof payload.line === 'number' ? payload.line : undefined) }))
      return
    }
    if (action === 'export-html') {
      if (typeof payload.path === 'string' && session.path?.toLocaleLowerCase() !== payload.path.toLocaleLowerCase()) throw new Error('The requested document is not active.')
      window.electronAPI.respondCodexBridge(requestId, buildExportDocument(editorEl(), session.displayName.replace(/\.(md|markdown|mdown|mkd)$/i, '')))
    }
  } catch (error) { window.electronAPI.respondCodexBridge(requestId, null, error instanceof Error ? error.message : String(error)) }
}

function setCloseSaveFrozen(frozen: boolean): void {
  windowCloseSaveInProgress = frozen
  document.body.classList.toggle('window-close-saving', frozen)
  editorEl().setAttribute('aria-busy', String(frozen))
  sourceEl().readOnly = frozen
  getEditorView()?.setProps({ editable: () => !frozen })
}

function cancelAutosaveTimer(session: DocumentSession): void {
  if (session.autosaveTimer) clearTimeout(session.autosaveTimer)
  session.autosaveTimer = null
}

function displayName(path: string | null, fallback = t('untitled')): string { return path?.split(/[/\\]/).pop() || fallback }
function contentOf(session: DocumentSession): string {
  if (session.documentId !== activeDocumentId) return session.content
  // Source-only and split both use the mirrored textarea as the serialization
  // authority. Source input updates session.content immediately; WYSIWYG
  // updates mirror back into it without dispatching an input event.
  return authoritativeContent(session.mode, sourceEl().value, getMarkdown())
}

function makeSession(data: DocumentPayload): DocumentSession {
  return {
    documentId: data.documentId, path: data.path, displayName: data.displayName || displayName(data.path), content: data.content,
    lastSavedContent: data.content, revision: data.revision, deleted: false, dirty: false, conflict: null, forceOverwrite: false,
    mode: 'wysiwyg', sourceScroll: 0, editorScroll: 0, collapsedHeadings: new Set(), codeWrap: new Set(), autosaveTimer: null,
    editVersion: 0, saveTail: Promise.resolve(false), pendingSaveTarget: null, pendingSaveTargetKey: null, closing: false,
  }
}

function snapshotActive(): void {
  const session = activeSession()
  if (!session) return
  // Serialization is synchronous, so tab switches/close/save cannot wait for
  // Milkdown's debounced markdownUpdated listener to report an edit.
  markSessionChanged(session, contentOf(session))
  session.sourceScroll = sourceEl().scrollTop
  session.editorScroll = editorEl().scrollTop
  flushAnnotations(session.documentId)
}

function setDirty(session: DocumentSession, dirty: boolean, forceNotify = false): void {
  const changed = session.dirty !== dirty
  session.dirty = dirty
  if (changed || forceNotify) {
    window.electronAPI.setDocumentState(session.documentId, dirty)
    // setDocumentState also binds the compatibility image node view. Restore
    // that binding after a background tab save updates its own dirty state.
    const current = activeSession()
    if (current && current !== session) window.electronAPI.setDocumentState(current.documentId, current.dirty)
  }
  if (changed) { renderTabs(); renderConflict() }
}

function markSessionChanged(session: DocumentSession, content: string): void {
  session.editVersion = nextEditVersion(session.editVersion, session.content, content)
  session.content = content
  // This immediately tells the main process a tab has changed, even when it
  // was already dirty. Close safety must never depend on a 200 ms serializer.
  setDirty(session, content !== session.lastSavedContent, true)
  if (session.dirty) scheduleAutosave(session)
  scheduleStatus(); scheduleOutline(); scheduleTasks(); scheduleLongDocumentPaint()
}

function scheduleAutosave(session: DocumentSession): void {
  if (!autosaveEnabled || session.closing || !session.path || session.conflict || !session.dirty) return
  if (session.autosaveTimer) clearTimeout(session.autosaveTimer)
  const documentId = session.documentId
  session.autosaveTimer = setTimeout(() => {
    session.autosaveTimer = null
    const current = sessions.get(documentId)
    if (!autosaveEnabled || !current || current.closing || current.conflict || !current.path || !current.dirty) return
    void saveSession(current, false, false)
  }, 1200)
}

async function saveSession(session: DocumentSession, saveAs: boolean, allowForce: boolean): Promise<boolean> {
  if (session.documentId === activeDocumentId) snapshotActive()
  // Manual saves and autosaves share a per-document chain. Importantly, the
  // snapshot is captured *inside* this callback, after prior writes settle.
  const queued = session.saveTail.catch(() => false).then(async () => {
    if (session.documentId === activeDocumentId) snapshotActive()
    const content = session.content
    const editVersion = session.editVersion
    const revision = session.revision
    const force = allowForce && session.forceOverwrite
    const retryTarget = force ? session.pendingSaveTarget ?? undefined : undefined
    const payload = { documentId: session.documentId, content, baseRevision: revision, force, retryTarget }
    const result = saveAs
      ? await window.electronAPI.saveDocumentAs(payload)
      : await window.electronAPI.saveDocument(payload)
    if (result.conflict) {
      session.conflict = result.conflict
      session.pendingSaveTarget = result.conflict.target ?? session.pendingSaveTarget
      session.pendingSaveTargetKey = result.conflict.targetKey ?? session.pendingSaveTargetKey
      session.forceOverwrite = false
      renderConflict()
      return false
    }
    if (!result.ok || !result.revision) {
      if (result.cancelled) { session.pendingSaveTarget = null; session.pendingSaveTargetKey = null }
      return false
    }
    session.path = result.path ?? session.path
    session.displayName = displayName(session.path, session.displayName)
    session.revision = result.revision
    session.deleted = false
    session.lastSavedContent = content
    session.conflict = null
    session.forceOverwrite = false
    session.pendingSaveTarget = null
    session.pendingSaveTargetKey = null
    const stillDirty = remainsDirtyAfterSave(session.editVersion, editVersion, session.content, content)
    // Main has just marked its session clean. Force the real current state
    // back across IPC if typing continued while the write awaited I/O.
    setDirty(session, stillDirty, true)
    if (stillDirty) scheduleAutosave(session)
    renderTabs(); renderConflict(); void refreshSiblings()
    return true
  })
  session.saveTail = queued
  return queued
}

function replaceEditorMarkdown(session: DocumentSession, content: string): void {
  pendingProgrammaticMarkdown = { documentId: session.documentId, markdown: null }
  applyingDocument = true
  setMarkdown(content)
  // The transaction hook is queued after this synchronous replacement and is
  // ignored by its exact resulting Markdown, never by a timed suppression.
  pendingProgrammaticMarkdown.markdown = getMarkdown()
  applyingDocument = false
}

function applySession(session: DocumentSession): void {
  ;(document.getElementById('empty-workspace') as HTMLElement).hidden = true
  document.body.classList.remove('welcome-mode')
  document.body.classList.toggle('source-only-mode', session.mode === 'source')
  document.body.classList.toggle('split-mode', session.mode === 'split')
  sourceEl().value = session.content
  replaceEditorMarkdown(session, session.content)
  window.requestAnimationFrame(() => {
    editorEl().scrollTop = session.editorScroll
    sourceEl().scrollTop = session.sourceScroll
    applyHeadingCollapse(session.collapsedHeadings)
    applyCodeWrap(session.codeWrap)
    scheduleOutline(); scheduleTasks(); scheduleStatus(); scheduleLongDocumentPaint()
    ensureAnnotations(session.documentId)
    scheduleCommentMarks()
    if (reviewMode) renderReview()
  })
}

function showEmptyWorkspace(): void {
  activeDocumentId = null
  document.body.classList.remove('source-only-mode', 'split-mode')
  document.body.classList.add('welcome-mode')
  sourceEl().value = ''
  ;(document.getElementById('empty-workspace') as HTMLElement).hidden = false
  renderWelcomeRecent()
  applyingDocument = true
  setMarkdown('')
  applyingDocument = false
  fileListEl().replaceChildren()
  document.querySelectorAll<HTMLElement>('.colamd-floating-table-tools,.colamd-code-copy,.colamd-code-options,.colamd-image-resizer,#colamd-heading-controls').forEach((element) => { element.hidden = true })
  renderTabs()
  renderConflict()
  updatePanelVisibility()
  scheduleOutline()
  scheduleTasks()
  scheduleStatus()
}

function scheduleSplitSourceRender(session: DocumentSession): void {
  splitRenderDocumentId = session.documentId
  if (splitRenderFrame !== null) return
  splitRenderFrame = requestAnimationFrame(() => {
    splitRenderFrame = null
    const documentId = splitRenderDocumentId
    splitRenderDocumentId = null
    const current = documentId ? sessions.get(documentId) : null
    // Never render a queued source change into a tab that was switched away.
    if (!current || activeDocumentId !== documentId || current.mode !== 'split') return
    replaceEditorMarkdown(current, current.content)
    applyHeadingCollapse(current.collapsedHeadings)
    applyCodeWrap(current.codeWrap)
  })
}

function activateSession(documentId: string, payload?: Partial<DocumentPayload>): void {
  snapshotActive()
  let session = sessions.get(documentId)
  if (!session && payload?.content !== undefined && payload.path !== undefined && payload.displayName !== undefined && payload.revision !== undefined) {
    session = makeSession(payload as DocumentPayload)
    sessions.set(documentId, session)
  }
  if (!session) return
  if (payload?.content !== undefined && (!session.dirty || session.content === session.lastSavedContent)) {
    session.content = payload.content
    session.lastSavedContent = payload.content
    session.revision = payload.revision ?? session.revision
  }
  if (payload?.path !== undefined) session.path = payload.path
  if (payload?.displayName) session.displayName = payload.displayName
  activeDocumentId = documentId
  // Also binds the compatibility image node view to this exact session. The
  // preload forwards that id with its resource IPC; main does not infer it.
  window.electronAPI.setDocumentState(session.documentId, session.dirty)
  applySession(session)
  renderTabs(); renderConflict(); updatePanelVisibility(); void refreshSiblings()
}

function renderTabs(): void {
  const root = tabsEl(); root.replaceChildren()
  for (const session of sessions.values()) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'document-tab'; tab.role = 'tab'
    tab.dataset.documentId = session.documentId; tab.setAttribute('aria-selected', String(session.documentId === activeDocumentId))
    if (session.documentId === activeDocumentId) tab.classList.add('active')
    if (session.dirty) tab.classList.add('dirty')
    const dirty = document.createElement('span'); dirty.className = 'tab-dirty-dot'; dirty.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = session.displayName
    const close = document.createElement('span'); close.className = 'tab-close'; close.innerHTML = iconSvg('x', 11); close.title = t('closeTab'); close.setAttribute('aria-label', t('closeTab'))
    tab.append(dirty, label, close); root.appendChild(tab)
  }
}

async function requestCloseTab(documentId: string): Promise<void> {
  const session = sessions.get(documentId)
  if (!session) return
  const closeIndex = [...sessions.keys()].indexOf(documentId)
  if (session.closing) return
  session.closing = true
  if (session.autosaveTimer) clearTimeout(session.autosaveTimer)
  session.autosaveTimer = null
  const cancelClose = (): void => {
    session.closing = false
    if (session.dirty) scheduleAutosave(session)
  }
  const awaitLatestSave = async (): Promise<void> => {
    while (true) {
      const tail = session.saveTail
      await tail.catch(() => false)
      if (tail === session.saveTail) return
    }
  }
  while (sessions.get(documentId) === session) {
    if (session.documentId === activeDocumentId) snapshotActive()
    // A discarded tab must not race an already queued autosave and let that
    // write resurrect main-process state after the document is removed.
    await awaitLatestSave()
    if (!session.dirty) {
      if (await window.electronAPI.closeDocument(documentId)) break
      cancelClose()
      return
    }
    const decision = await window.electronAPI.confirmCloseDocument(documentId)
    if (decision === 'cancel') { cancelClose(); return }
    if (decision === 'save') {
      if (!await saveSession(session, false, true)) { cancelClose(); return }
      continue
    }
    // A save can have started while the dialog was visible. If it changed the
    // dirty state, loop for a fresh explicit decision rather than discarding a
    // different version than the user saw.
    await awaitLatestSave()
    if (session.dirty && !await window.electronAPI.closeDocument(documentId, true)) continue
    if (!session.dirty && !await window.electronAPI.closeDocument(documentId)) { cancelClose(); return }
    break
  }
  if (session.autosaveTimer) clearTimeout(session.autosaveTimer)
  sessions.delete(documentId)
  if (activeDocumentId === documentId) {
    const remaining = [...sessions.values()]
    const next = remaining[Math.min(Math.max(0, closeIndex), Math.max(0, remaining.length - 1))]
    if (next) await window.electronAPI.activateDocument(next.documentId)
    else showEmptyWorkspace()
  } else {
    renderTabs()
  }
}

async function saveAllBeforeWindowClose(): Promise<void> {
  if (windowCloseSaveInProgress) return
  // Capture the one live editor before freezing it; inactive tab content is
  // already kept synchronously by the transaction/source handlers.
  snapshotActive()
  const gated = [...sessions.values()].filter((session) => session.dirty)
  if (!gated.length) {
    // Main rejects an acknowledgement if its authoritative dirty aggregate is
    // not clean yet. Clear its prompt state without leaving a frozen UI.
    if (!await window.electronAPI.completeCloseSave(true)) await window.electronAPI.completeCloseSave(false)
    return
  }
  setCloseSaveFrozen(true)
  for (const session of gated) {
    session.closing = true
    cancelAutosaveTimer(session)
  }
  const awaitLatestSave = async (session: DocumentSession): Promise<void> => {
    while (true) {
      const tail = session.saveTail
      await tail.catch(() => false)
      if (tail === session.saveTail) return
    }
  }
  let complete = false
  try {
    // A pre-freeze transaction may finish while its prior save is in flight.
    // Keep saving those exact new versions until every tab is demonstrably
    // clean; a successful older snapshot alone is never closeable.
    while (!aggregateCloseCanComplete(sessions.values())) {
      const dirty = [...sessions.values()].filter((session) => session.dirty)
      for (const session of dirty) {
        await awaitLatestSave(session)
        if (!session.dirty) continue
        if (!await saveSession(session, false, true)) throw new Error('close-save-failed')
        await awaitLatestSave(session)
      }
    }
    complete = true
  } catch {
    complete = false
  }
  if (complete && await window.electronAPI.completeCloseSave(true)) return
  setCloseSaveFrozen(false)
  for (const session of gated) {
    session.closing = false
    if (session.dirty) scheduleAutosave(session)
  }
  await window.electronAPI.completeCloseSave(false)
}

function renderConflict(): void {
  const session = activeSession(); const conflict = session?.conflict
  conflictBannerEl().hidden = !conflict
  if (!conflict || !session) { visibleConflictDocumentId = null; conflictDiffEl().hidden = true; return }
  if (visibleConflictDocumentId !== session.documentId) {
    visibleConflictDocumentId = session.documentId
    conflictDiffEl().hidden = true
    requestAnimationFrame(() => (document.getElementById('conflict-keep-btn') as HTMLButtonElement | null)?.focus())
  }
  ;(document.getElementById('conflict-title') as HTMLElement).textContent = t('externalChanges')
  ;(document.getElementById('conflict-message') as HTMLElement).textContent = t('externalChangesMessage')
}

function setMode(mode: EditorMode): void {
  const session = activeSession(); if (!session) return
  snapshotActive(); session.mode = mode; applySession(session)
}

function toggleSourceMode(): void { const session = activeSession(); if (session) setMode(session.mode === 'source' ? 'wysiwyg' : 'source') }
function toggleSplitMode(): void { const session = activeSession(); if (session) setMode(session.mode === 'split' ? 'wysiwyg' : 'split') }

function syncScroll(from: HTMLElement, to: HTMLElement): void {
  if (sourceSyncing) return
  const fromMax = Math.max(1, from.scrollHeight - from.clientHeight)
  const toMax = Math.max(0, to.scrollHeight - to.clientHeight)
  sourceSyncing = true
  to.scrollTop = Math.round((from.scrollTop / fromMax) * toMax)
  window.requestAnimationFrame(() => { sourceSyncing = false })
}

function countWords(content: string): number { return content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu)?.length ?? 0 }
function scheduleStatus(): void {
  if (statusFrame !== null) return
  statusFrame = requestAnimationFrame(() => { statusFrame = null; const content = activeSession() ? contentOf(activeSession()!) : ''; statusWordsEl().textContent = `${t('words')} ${countWords(content)}`; statusCharactersEl().textContent = `${t('characters')} ${(content.match(/\S/g) ?? []).length}`; statusLinesEl().textContent = `${t('lines')} ${content.split(/\r\n?|\n/).length}` })
}

function scheduleOutline(): void {
  if (outlineFrame !== null) return
  outlineFrame = requestAnimationFrame(() => { outlineFrame = null; outlinePanel?.render(activeSession()?.mode !== 'source') })
}

function revealHeadingFromOutline(position: number): void {
  const session = activeSession()
  const view = getEditorView()
  if (!session || !view || position < 0) return
  const ancestors: Array<{ position: number; level: number }> = []
  view.state.doc.forEach((node, nodePosition) => {
    if (nodePosition >= position || node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    while (ancestors.length && ancestors[ancestors.length - 1].level >= level) ancestors.pop()
    ancestors.push({ position: nodePosition, level })
  })
  let changed = false
  for (const ancestor of ancestors) changed = session.collapsedHeadings.delete(String(ancestor.position)) || changed
  if (changed) applyHeadingCollapse(session.collapsedHeadings)
}

/**
 * A guarded paint optimisation for reading very large documents. Editing,
 * table interaction, selections, find navigation, and outline jumps keep the
 * editor focused and therefore remove content-visibility before coordinates
 * can be queried. Small documents never enter this mode.
 */
function scheduleLongDocumentPaint(): void {
  if (longPaintFrame !== null) return
  longPaintFrame = requestAnimationFrame(() => {
    longPaintFrame = null
    const session = activeSession()
    const content = session ? contentOf(session) : ''
    const enabled = Boolean(session && session.mode !== 'source' && (content.length >= LONG_DOCUMENT_CHAR_THRESHOLD || content.split(/\r\n?|\n/).length >= LONG_DOCUMENT_LINE_THRESHOLD))
    document.body.classList.toggle('long-document-paint', enabled)
    const root = editorEl().querySelector<HTMLElement>('.ProseMirror')
    if (!root) return
    const editable = getEditorView()?.hasFocus()
    for (const block of Array.from(root.children) as HTMLElement[]) {
      const suitable = block.matches('p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol') && !block.querySelector('table,pre,.tableWrapper')
      block.classList.toggle('colamd-incremental-block', enabled && suitable && !editable)
    }
  })
}

function scheduleTasks(): void {
  if (taskFrame !== null) return
  taskFrame = requestAnimationFrame(() => { taskFrame = null; renderTasks() })
}

function renderTasks(): void {
  const list = document.getElementById('tasks-list') as HTMLElement
  const empty = document.getElementById('tasks-empty') as HTMLElement
  const onlyOpen = (document.getElementById('tasks-open-only') as HTMLInputElement).checked
  const session = activeSession(); list.replaceChildren()
  if (session) {
    const matcher = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/gm
    for (const match of session.content.matchAll(matcher)) {
      const done = match[1].toLowerCase() === 'x'; if (onlyOpen && done) continue
      const button = document.createElement('button'); button.type = 'button'; button.className = 'task-item'; button.textContent = `${done ? '☑' : '☐'} ${match[2]}`; button.dataset.task = match[2]
      list.appendChild(button)
    }
  }
  empty.hidden = list.childElementCount > 0
}

function updatePanelVisibility(): void {
  const show = Boolean(activeSession()?.path) && !manualPanelHidden
  panelEl().hidden = !show; document.body.classList.toggle('show-file-panel', show)
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('colamd-layout-changed')))
}

function setPanel(tab: SidePanelTab): void {
  activePanelTab = tab; localStorage.setItem('file-panel-tab', tab)
  for (const name of ['files', 'outline', 'tasks'] as SidePanelTab[]) {
    const button = document.getElementById(`${name}-tab`) as HTMLButtonElement
    const panel = document.getElementById(`${name}-panel`) as HTMLElement
    const active = name === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); panel.hidden = !active
  }
  if (tab === 'outline') scheduleOutline(); if (tab === 'tasks') scheduleTasks()
}

// ---------- 批注与审阅 ----------

const reviewPanelEl = () => document.getElementById('review-panel') as HTMLElement
const reviewToggleEl = () => document.getElementById('review-toggle-btn') as HTMLButtonElement

function setReviewMode(on: boolean): void {
  reviewMode = on
  localStorage.setItem('colamd-review-mode', on ? '1' : '0')
  reviewPanelEl().hidden = !on
  document.body.classList.toggle('show-review-panel', on)
  reviewToggleEl().classList.toggle('active', on)
  reviewToggleEl().setAttribute('aria-pressed', String(on))
  if (on) renderReview()
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('colamd-layout-changed')))
}

function scheduleCommentMarks(): void {
  if (reviewMarksFrame !== null) return
  reviewMarksFrame = requestAnimationFrame(() => {
    reviewMarksFrame = null
    refreshCommentMarks()
  })
}

function refreshCommentMarks(): void {
  const session = activeSession()
  if (!session || session.mode === 'source') { applyCommentMarks([]); return }
  const data = getAnnotations(session.documentId)
  const ranges: CommentMarkRange[] = []
  for (const comment of data.comments) {
    if (comment.resolved) continue
    const range = locatePlainTextRange(comment.anchor, comment.prefix, comment.suffix)
    if (range) ranges.push({ ...range, kind: 'comment' })
  }
  for (const suggestion of data.suggestions) {
    if (suggestion.status !== 'pending') continue
    const range = locatePlainTextRange(suggestion.anchor, suggestion.prefix, suggestion.suffix)
    if (range) ranges.push({ ...range, kind: 'suggestion' })
  }
  applyCommentMarks(ranges)
}

function revealAnnotation(anchor: string, prefix: string, suffix: string): void {
  const range = locatePlainTextRange(anchor, prefix, suffix)
  if (!range) return
  const view = getEditorView()
  if (!view) return
  try {
    const coords = view.coordsAtPos(range.from)
    const editor = editorEl()
    editor.scrollTo({ top: editor.scrollTop + coords.top - editor.getBoundingClientRect().top - editor.clientHeight / 2, behavior: 'smooth' })
  } catch {}
}

function openCommentEditor(): void {
  const view = getEditorView()
  const session = activeSession()
  if (!view || !session || view.state.selection.empty) return
  const { from, to } = view.state.selection
  const anchor = view.state.doc.textBetween(from, to)
  if (!anchor.trim()) return
  const fullText = view.state.doc.textBetween(0, view.state.doc.content.size)
  const { prefix, suffix } = contextAround(fullText, from, to)
  let coords = { left: 32, bottom: 72 }
  try { coords = view.coordsAtPos(from) } catch {}

  const popover = document.createElement('div')
  popover.className = 'comment-editor-popover'
  const quote = document.createElement('blockquote')
  quote.className = 'comment-editor-quote'
  quote.textContent = anchor.length > 80 ? `${anchor.slice(0, 80)}…` : anchor
  const textarea = document.createElement('textarea')
  textarea.className = 'comment-editor-input'
  textarea.rows = 3
  textarea.placeholder = t('commentPlaceholder')
  const footer = document.createElement('div')
  footer.className = 'comment-editor-footer'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'math-modal-btn cancel'
  cancel.textContent = t('cancel')
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'math-modal-btn save'
  save.textContent = t('save')
  footer.append(cancel, save)
  popover.append(quote, textarea, footer)
  document.body.appendChild(popover)
  const width = 300
  popover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, coords.left))}px`
  popover.style.top = `${Math.max(60, Math.min(window.innerHeight - 220, coords.bottom + 8))}px`

  const close = (): void => { popover.remove(); view.focus() }
  cancel.addEventListener('click', close)
  popover.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save.click() }
  })
  save.addEventListener('click', () => {
    const text = textarea.value.trim()
    if (text) {
      addComment(session.documentId, {
        id: makeAnnotationId('c'), anchor, prefix, suffix, text,
        createdAt: Date.now(), resolved: false,
      })
      setReviewMode(true)
    }
    close()
  })
  setTimeout(() => textarea.focus(), 30)
}

function reviewItemTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function acceptSuggestionItem(suggestion: AnnotationSuggestion): void {
  const session = activeSession()
  if (!session) return
  const content = contentOf(session)
  const located = locateAnchor(content, suggestion.anchor, suggestion.prefix, suggestion.suffix)
  if (!located) {
    showCodexToast(t('suggestionNotFound'))
    return
  }
  const next = content.slice(0, located.from) + suggestion.replacement + content.slice(located.to)
  session.content = next
  sourceEl().value = next
  if (session.mode !== 'source') replaceEditorMarkdown(session, next)
  setDirty(session, true, true)
  scheduleAutosave(session)
  setSuggestionStatus(session.documentId, suggestion.id, 'accepted')
}

function renderReview(): void {
  const list = document.getElementById('review-list') as HTMLElement | null
  const empty = document.getElementById('review-empty') as HTMLElement | null
  if (!list || !empty) return
  list.replaceChildren()
  const session = activeSession()
  const data = session ? getAnnotations(session.documentId) : { version: 1 as const, comments: [], suggestions: [] }
  const comments = data.comments.filter((comment) => reviewFilter === 'all' || (reviewFilter === 'resolved') === comment.resolved)
  const suggestions = data.suggestions.filter((suggestion) =>
    reviewFilter === 'all' || (reviewFilter === 'resolved' ? suggestion.status !== 'pending' : suggestion.status === 'pending'))
  empty.hidden = comments.length + suggestions.length > 0

  for (const suggestion of suggestions) {
    const item = document.createElement('div')
    item.className = `review-item suggestion ${suggestion.status}`
    const head = document.createElement('div')
    head.className = 'review-item-head'
    const kind = document.createElement('span')
    kind.className = 'review-item-kind'
    kind.textContent = `${t('suggestionKind')} · ${suggestion.source === 'codex' ? 'Codex' : t('commentKind')}`
    const time = document.createElement('time')
    time.textContent = reviewItemTime(suggestion.createdAt)
    head.append(kind, time)
    const anchor = document.createElement('blockquote')
    anchor.className = 'review-item-anchor'
    anchor.textContent = suggestion.anchor.length > 120 ? `${suggestion.anchor.slice(0, 120)}…` : suggestion.anchor
    const title = document.createElement('div')
    title.className = 'review-item-text'
    title.textContent = suggestion.title
    const actions = document.createElement('div')
    actions.className = 'review-item-actions'
    if (suggestion.status === 'pending') {
      const reject = document.createElement('button')
      reject.type = 'button'
      reject.className = 'ghost'
      reject.textContent = t('rejectSuggestion')
      reject.addEventListener('click', () => { if (session) setSuggestionStatus(session.documentId, suggestion.id, 'rejected') })
      const accept = document.createElement('button')
      accept.type = 'button'
      accept.className = 'primary'
      accept.textContent = t('acceptSuggestion')
      accept.addEventListener('click', () => acceptSuggestionItem(suggestion))
      actions.append(reject, accept)
    } else {
      const status = document.createElement('span')
      status.className = `review-status ${suggestion.status}`
      status.textContent = suggestion.status === 'accepted' ? t('statusAccepted') : t('statusRejected')
      actions.append(status)
    }
    item.append(head, anchor, title, actions)
    anchor.addEventListener('click', () => revealAnnotation(suggestion.anchor, suggestion.prefix, suggestion.suffix))
    list.appendChild(item)
  }

  for (const comment of comments) {
    const item = document.createElement('div')
    item.className = `review-item comment${comment.resolved ? ' resolved' : ''}`
    const head = document.createElement('div')
    head.className = 'review-item-head'
    const kind = document.createElement('span')
    kind.className = 'review-item-kind'
    kind.textContent = t('commentKind')
    const time = document.createElement('time')
    time.textContent = reviewItemTime(comment.createdAt)
    head.append(kind, time)
    const anchor = document.createElement('blockquote')
    anchor.className = 'review-item-anchor'
    anchor.textContent = comment.anchor.length > 120 ? `${comment.anchor.slice(0, 120)}…` : comment.anchor
    const text = document.createElement('div')
    text.className = 'review-item-text'
    text.textContent = comment.text
    const actions = document.createElement('div')
    actions.className = 'review-item-actions'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'ghost'
    toggle.textContent = comment.resolved ? t('reopenComment') : t('resolveComment')
    toggle.addEventListener('click', () => { if (session) setCommentResolved(session.documentId, comment.id, !comment.resolved) })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ghost danger'
    remove.textContent = t('deleteComment')
    remove.addEventListener('click', () => { if (session) deleteComment(session.documentId, comment.id) })
    actions.append(toggle, remove)
    item.append(head, anchor, text, actions)
    anchor.addEventListener('click', () => revealAnnotation(comment.anchor, comment.prefix, comment.suffix))
    list.appendChild(item)
  }
}

async function refreshSiblings(): Promise<void> {
  const session = activeSession(); if (!session?.path) { fileListEl().replaceChildren(); return }
  const files = await window.electronAPI.listSiblings(session.documentId); if (!files || session !== activeSession()) return
  const list = fileListEl(); list.replaceChildren()
  for (const file of files) { const item = document.createElement('li'); const button = document.createElement('button'); button.textContent = file.name; button.dataset.path = file.path; if (file.path === session.path) button.classList.add('active'); item.append(button); list.append(item) }
}

function renderRecent(): void {
  const menu = recentMenuEl(); menu.replaceChildren()
  if (!recent.length) { const empty = document.createElement('span'); empty.textContent = t('noRecentFiles'); menu.append(empty) }
  for (const file of recent) { const button = document.createElement('button'); button.type = 'button'; button.textContent = file.name; button.title = file.path; button.dataset.path = file.path; button.disabled = file.missing; menu.append(button) }
  renderWelcomeRecent()
}

function renderWelcomeRecent(): void {
  const list = document.getElementById('welcome-recent-list') as HTMLElement | null
  if (!list) return
  list.replaceChildren()
  if (!recent.length) {
    const empty = document.createElement('span')
    empty.className = 'welcome-recent-empty'
    empty.textContent = t('noRecentFiles')
    list.append(empty)
    return
  }
  for (const file of recent.slice(0, 6)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'welcome-recent-item'
    button.dataset.path = file.path
    button.disabled = file.missing
    button.title = file.path
    const name = document.createElement('span')
    name.className = 'welcome-recent-name'
    name.textContent = file.name
    const path = document.createElement('span')
    path.className = 'welcome-recent-path'
    path.textContent = file.missing ? t('missingFile') : file.path
    button.append(name, path)
    list.append(button)
  }
}

function showMenu(element: HTMLElement, x: number, y: number): void {
  element.hidden = false
  const margin = 8
  const width = element.offsetWidth
  const height = element.offsetHeight
  // Flip toward the window interior when the menu would overflow an edge,
  // instead of letting it slide away from the pointer.
  const overflowRight = x + width > window.innerWidth - margin
  const overflowBottom = y + height > window.innerHeight - margin
  const left = overflowRight ? Math.max(margin, x - width) : x
  const top = overflowBottom ? Math.max(margin, y - height) : y
  element.style.left = `${Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin))}px`
  element.style.top = `${Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin))}px`
}
function hideMenus(): void {
  for (const id of ['command-palette', 'slash-command-menu', 'selection-command-menu', 'image-resource-menu', 'link-preview', 'codex-menu', 'fullscreen-view-menu']) document.getElementById(id)?.setAttribute('hidden', '')
  codexButtonEl().setAttribute('aria-expanded', 'false')
  fullscreenViewButtonEl().setAttribute('aria-expanded', 'false')
}

const commands = new CommandRegistry()
function registerCommands(search: SearchPanel): void {
  const format = ['paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'strong', 'emphasis', 'link', 'inline-code', 'code-fence', 'quote', 'horizontal-rule', 'ordered-list', 'unordered-list', 'task-list']
  const labels: Record<string, Parameters<typeof t>[0]> = {
    paragraph: 'paragraph', 'heading-1': 'heading1', 'heading-2': 'heading2', 'heading-3': 'heading3', 'heading-4': 'heading4', 'heading-5': 'heading5', 'heading-6': 'heading6',
    strong: 'bold', emphasis: 'italic', link: 'link', 'inline-code': 'inlineCode', 'code-fence': 'codeFence', quote: 'quote', 'horizontal-rule': 'horizontalRule', 'ordered-list': 'orderedList', 'unordered-list': 'unorderedList', 'task-list': 'taskList',
  }
  for (const id of format) commands.register({ id: `format.${id}`, label: () => t(labels[id]), enabled: () => !windowCloseSaveInProgress, execute: () => { runFormattingCommand(id) } })
  commands.register({ id: 'insert.table', label: () => t('insertTable'), enabled: () => !windowCloseSaveInProgress, execute: () => { insertTable() } })
  commands.register({ id: 'editor.search', label: () => t('find'), execute: () => search.show() })
  commands.register({ id: 'editor.math', label: () => t('insertFormula'), enabled: () => !windowCloseSaveInProgress, execute: () => showMathModal() })
  commands.register({ id: 'editor.palette', label: () => t('commandPalette'), execute: () => openPalette() })
  commands.register({ id: 'file.new', label: () => t('newFile'), enabled: () => !windowCloseSaveInProgress, execute: async () => { await window.electronAPI.newDocument() } })
  commands.register({ id: 'file.open', label: () => t('open'), enabled: () => !windowCloseSaveInProgress, execute: async () => { await window.electronAPI.openFile() } })
  commands.register({ id: 'file.closeTab', label: () => t('closeTab'), enabled: () => !windowCloseSaveInProgress && Boolean(activeSession()), execute: async () => { const session = activeSession(); if (session) await requestCloseTab(session.documentId) } })
  commands.register({ id: 'file.save', label: () => t('save'), enabled: () => !windowCloseSaveInProgress, execute: async () => { const session = activeSession(); if (session) await saveSession(session, false, true) } })
  commands.register({ id: 'file.saveAs', label: () => t('saveAs'), enabled: () => !windowCloseSaveInProgress, execute: async () => { const session = activeSession(); if (session) await saveSession(session, true, true) } })
  for (const extension of ['pdf', 'png', 'html', 'docx'] as ExportFormat[]) commands.register({ id: `file.export.${extension}`, label: () => extension.toUpperCase(), execute: () => void exportCurrent(extension) })
  commands.register({ id: 'view.filePanel', label: () => t('toggleFileList'), execute: () => { manualPanelHidden = !manualPanelHidden; localStorage.setItem('file-panel-hidden', manualPanelHidden ? '1' : '0'); updatePanelVisibility() } })
  commands.register({ id: 'view.source', label: () => t('sourceMode'), execute: toggleSourceMode })
  commands.register({ id: 'view.split', label: () => t('splitView'), execute: toggleSplitMode })
  commands.register({ id: 'view.review', label: () => t('reviewMode'), keywords: () => ['review', 'comment', '审阅', '批注'], execute: () => setReviewMode(!reviewMode) })
  commands.register({ id: 'app.settings', label: () => t('settings'), keywords: () => ['preferences', 'font', 'theme', 'Codex'], execute: openSettings })
  commands.register({ id: 'codex.sendSelection', label: () => t('codexSendSelection'), keywords: () => ['Codex', 'AI', 'selection'], enabled: () => appSettings.codexEnabled && Boolean(activeSession()), execute: () => sendCodexContext('selection') })
  commands.register({ id: 'codex.sendSection', label: () => t('codexSendSection'), keywords: () => ['Codex', 'AI', 'section', 'heading'], enabled: () => appSettings.codexEnabled && Boolean(activeSession()), execute: () => sendCodexContext('section') })
  commands.register({ id: 'codex.checkDocument', label: () => t('codexCheckDocument'), keywords: () => ['Codex', 'AI', 'Markdown', 'check'], enabled: () => appSettings.codexEnabled && Boolean(activeSession()), execute: () => sendCodexContext('document') })
  commands.register({ id: 'help.demo', label: () => t('featureDemo'), execute: async () => { await window.electronAPI.openFeatureDemo() } })
}

function paletteElement(): HTMLDivElement {
  let element = document.getElementById('command-palette') as HTMLDivElement | null
  if (element) return element
  element = document.createElement('div'); element.id = 'command-palette'; element.className = 'command-surface'; element.hidden = true
  element.innerHTML = '<input type="search" autocomplete="off"><div class="command-list"></div>'
  document.body.append(element)
  const input = element.querySelector('input') as HTMLInputElement
  input.addEventListener('input', () => renderCommandList(element!, input.value, false))
  input.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideMenus(); if (event.key === 'Enter') (element?.querySelector<HTMLButtonElement>('.command-option'))?.click() })
  return element
}

function renderCommandList(surface: HTMLElement, query: string, slash: boolean): void {
  const list = surface.querySelector('.command-list') as HTMLElement; list.replaceChildren()
  for (const command of commands.list(query).slice(0, 12)) {
    const option = document.createElement('button'); option.type = 'button'; option.className = 'command-option'; option.textContent = command.label(); option.dataset.command = command.id
    option.addEventListener('click', () => { if (slash) clearSlashQuery(); hideMenus(); commands.execute(command.id) }); list.append(option)
  }
}

function openPalette(): void { const palette = paletteElement(); hideMenus(); palette.hidden = false; const input = palette.querySelector('input') as HTMLInputElement; input.value = ''; renderCommandList(palette, '', false); input.focus() }
function updateSlashMenu(): void {
  const query = getSlashQuery(); let surface = document.getElementById('slash-command-menu') as HTMLDivElement | null
  if (query === null) { surface?.setAttribute('hidden', ''); return }
  if (!surface) { surface = document.createElement('div'); surface.id = 'slash-command-menu'; surface.className = 'command-surface'; surface.innerHTML = '<div class="command-list"></div>'; document.body.append(surface) }
  const view = getEditorView(); const coords = view ? view.coordsAtPos(view.state.selection.head) : { left: 32, bottom: 72 }
  showMenu(surface, coords.left, coords.bottom + 4); renderCommandList(surface, query, true)
}

function contextMenuSurface(): HTMLDivElement {
  let surface = document.getElementById('selection-command-menu') as HTMLDivElement | null
  if (!surface) {
    surface = document.createElement('div')
    surface.id = 'selection-command-menu'
    surface.className = 'selection-format-menu'
    // Keep the ProseMirror selection alive while commands are clicked. Native
    // cut/copy/paste then operate on the exact range that opened the menu.
    surface.addEventListener('pointerdown', (event) => event.preventDefault())
    document.body.append(surface)
  }
  return surface
}

function appendClipboardGrid(surface: HTMLElement, hasSelection: boolean): void {
  const grid = document.createElement('div'); grid.className = 'selection-edit-grid'
  const actions: Array<['cut' | 'copy' | 'paste' | 'delete', IconName, string]> = [
    ['cut', 'cut', t('cut')], ['copy', 'copy', t('copy')], ['paste', 'paste', t('paste')], ['delete', 'trash', t('deleteCurrentSelection')],
  ]
  for (const [action, icon, label] of actions) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'selection-edit-icon'; setButtonIcon(button, icon, 15); button.title = label; button.setAttribute('aria-label', button.title)
    button.disabled = action !== 'paste' && !hasSelection
    button.addEventListener('click', () => { hideMenus(); window.electronAPI.performEdit(action) })
    grid.append(button)
  }
  surface.append(grid)
}

function appendMenuRow(parent: HTMLElement, labelText: string, action: () => void, hintText = ''): HTMLButtonElement {
  const item = document.createElement('button'); item.type = 'button'; item.className = 'selection-format-row'
  const label = document.createElement('span'); label.textContent = labelText
  const hint = document.createElement('span'); hint.textContent = hintText
  item.append(label, hint); item.addEventListener('click', () => { hideMenus(); action() }); parent.append(item)
  return item
}

/** Shared hover/click submenu used by the insert menu and table row/column groups. */
function appendSubmenu(parent: HTMLElement, labelText: string, icon: IconName, items: Array<[string, () => void, string?]>, bordered = false): void {
  const host = document.createElement('div'); host.className = bordered ? 'selection-submenu-host bordered' : 'selection-submenu-host'
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'selection-format-row'
  trigger.innerHTML = `<span class="selection-row-label">${iconSvg(icon, 14)}<span>${labelText}</span></span><span class="selection-row-chevron">${iconSvg('chevronRight', 13)}</span>`
  const submenu = document.createElement('div'); submenu.className = 'selection-insert-submenu'; submenu.hidden = true
  for (const [label, action, hint] of items) appendMenuRow(submenu, label, action, hint)
  const position = (): void => {
    if (submenu.hidden) return
    const hostRect = host.getBoundingClientRect()
    const maximumHeight = Math.max(180, window.innerHeight - 16)
    submenu.style.maxHeight = `${maximumHeight}px`
    submenu.style.overflowY = 'auto'
    submenu.classList.toggle('opens-left', hostRect.right + 244 > window.innerWidth - 8)
    const height = Math.min(submenu.scrollHeight, maximumHeight)
    const spaceBelow = window.innerHeight - hostRect.top - 8
    const spaceAbove = hostRect.bottom - 8
    const openUpward = height > spaceBelow && spaceAbove > spaceBelow
    submenu.style.top = openUpward ? 'auto' : '0'
    submenu.style.bottom = openUpward ? '0' : 'auto'
  }
  const show = (): void => { submenu.hidden = false; position(); requestAnimationFrame(position) }
  const hide = (): void => { submenu.hidden = true }
  host.addEventListener('mouseenter', show); host.addEventListener('mouseleave', hide)
  trigger.addEventListener('click', (event) => { event.stopPropagation(); if (submenu.hidden) show(); else hide() })
  host.append(trigger, submenu); parent.append(host)
}

function appendInsertMenu(surface: HTMLElement): void {
  const insertActions: Array<[string, () => void, string?]> = [
    [t('insertImage'), () => { void insertImageFromPicker() }, 'Ctrl+Shift+I'],
    [t('insertTable'), () => { insertTable() }, 'Ctrl+T'],
    [t('codeFence'), () => { runFormattingCommand('code-fence') }, 'Ctrl+Shift+K'],
    [t('insertFormula'), () => showMathModal(), 'Ctrl+Shift+M'],
    [t('horizontalRule'), () => { runFormattingCommand('horizontal-rule') }],
    [t('insertParagraphAbove'), () => { insertParagraphNearSelection('before') }],
    [t('insertParagraphBelow'), () => { insertParagraphNearSelection('after') }],
  ]
  appendSubmenu(surface, t('slashMenu'), 'plus', insertActions, true)
}

function showEditorContextMenu(event: MouseEvent): void {
  const view = getEditorView(); if (!view) return
  const hasSelection = !view.state.selection.empty
  const surface = contextMenuSurface()
  surface.replaceChildren()
  appendClipboardGrid(surface, hasSelection)
  const grid = document.createElement('div'); grid.className = 'selection-format-grid'
  const formats: Array<[string, IconName]> = [
    ['format.strong', 'bold'], ['format.emphasis', 'italic'], ['format.inline-code', 'code'], ['format.link', 'link'],
    ['format.quote', 'quote'], ['format.ordered-list', 'listOrdered'], ['format.unordered-list', 'list'], ['format.task-list', 'task'],
  ]
  for (const [id, icon] of formats) {
    const command = commands.get(id); if (!command) continue
    const item = document.createElement('button'); item.type = 'button'; item.className = 'selection-format-icon'; setButtonIcon(item, icon, 15); item.title = command.label(); item.setAttribute('aria-label', command.label())
    item.addEventListener('click', () => { hideMenus(); commands.execute(id) }); grid.append(item)
  }
  const rows = document.createElement('div'); rows.className = 'selection-format-rows'
  for (const id of ['format.paragraph', 'format.heading-1', 'format.heading-2', 'format.heading-3']) {
    const command = commands.get(id); if (!command) continue
    const item = document.createElement('button'); item.type = 'button'; item.className = 'selection-format-row'
    const label = document.createElement('span'); label.textContent = command.label()
    const hint = document.createElement('span'); hint.textContent = id === 'format.paragraph' ? '¶' : `H${id.at(-1)}`
    item.append(label, hint); item.addEventListener('click', () => { hideMenus(); commands.execute(id) }); rows.append(item)
  }
  surface.append(grid, rows)
  if (appSettings.codexEnabled && hasSelection) appendMenuRow(rows, t('codexSendSelection'), () => {
    void sendCodexContext('selection')
  }, 'Codex')
  if (hasSelection) appendMenuRow(rows, t('addComment'), () => openCommentEditor(), '💬')
  appendInsertMenu(surface)
  showMenu(surface, event.clientX, event.clientY)
}

function showTableContextMenu(event: MouseEvent, cell: HTMLElement): void {
  const view = getEditorView(); if (!view) return
  const surface = contextMenuSurface(); surface.replaceChildren()
  appendClipboardGrid(surface, !view.state.selection.empty)
  const rows = document.createElement('div'); rows.className = 'selection-format-rows table-context-rows'
  appendSubmenu(rows, t('tableRow'), 'rows', [
    [t('insertRowAbove'), () => { runTableCommand('add-row-before', cell) }],
    [t('insertRowBelow'), () => { runTableCommand('add-row-after', cell) }],
    [t('deleteCurrentRow'), () => { runTableCommand('delete-row', cell) }],
  ])
  appendSubmenu(rows, t('tableColumn'), 'columns', [
    [t('insertColumnLeft'), () => { runTableCommand('add-column-before', cell) }],
    [t('insertColumnRight'), () => { runTableCommand('add-column-after', cell) }],
    [t('deleteCurrentColumn'), () => { runTableCommand('delete-column', cell) }],
  ])
  rows.append(document.createElement('hr'))
  const deleteRow = appendMenuRow(rows, t('deleteTable'), () => { runTableCommand('delete-table', cell) })
  deleteRow.classList.add('danger')
  surface.append(rows)
  showMenu(surface, event.clientX, event.clientY)
}

async function copyRenderedImage(image: HTMLImageElement, source: string): Promise<void> {
  try {
    const response = await fetch(image.currentSrc || image.src)
    const blob = await response.blob()
    if (blob.size > 0 && await window.electronAPI.copyImageBytes(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png')) return
  } catch {}
  await navigator.clipboard?.writeText(source)
}

function showImageResourceMenu(event: MouseEvent, source: string, image: HTMLImageElement): void {
  const session = activeSession()
  if (!session) return
  let surface = document.getElementById('image-resource-menu') as HTMLDivElement | null
  if (!surface) { surface = document.createElement('div'); surface.id = 'image-resource-menu'; surface.className = 'command-surface compact'; surface.innerHTML = '<div class="command-list"></div>'; document.body.append(surface) }
  const list = surface.querySelector('.command-list') as HTMLElement; list.replaceChildren()
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'command-option'; copy.textContent = t('copyImage')
  copy.addEventListener('click', () => { hideMenus(); void copyRenderedImage(image, source) })
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'command-option'; reset.textContent = t('resetImageSize')
  reset.addEventListener('click', () => { hideMenus(); setImageWidthAt(image, null) })
  list.append(copy, reset)
  if (!session.path || !isManagedRelativeImageSource(source)) { showMenu(surface, event.clientX, event.clientY); return }
  const reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'command-option'; reveal.textContent = t('revealInFolder')
  // Capture both identity and source at context-menu time. Switching tabs while
  // the menu is open cannot reveal an asset from a different document.
  const documentId = session.documentId
  reveal.addEventListener('click', () => { hideMenus(); void window.electronAPI.revealResourceForDocument(documentId, source) })
  list.append(reveal)
  showMenu(surface, event.clientX, event.clientY)
}

function installLinkPreview(): void {
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  const hide = (delay = 0): void => {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => document.getElementById('link-preview')?.setAttribute('hidden', ''), delay)
  }
  editorEl().addEventListener('mouseover', (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]'); if (!link) return
    let url: URL; try { url = new URL(link.href) } catch { return }
    if (!/^https?:$/.test(url.protocol)) return
    let surface = document.getElementById('link-preview') as HTMLDivElement | null
    if (!surface) { surface = document.createElement('div'); surface.id = 'link-preview'; surface.className = 'link-preview'; surface.addEventListener('mouseenter', () => { if (hideTimer) clearTimeout(hideTimer) }); surface.addEventListener('mouseleave', () => hide(80)); document.body.append(surface) }
    if (hideTimer) clearTimeout(hideTimer)
    surface.replaceChildren(); const label = document.createElement('span'); label.textContent = `${url.hostname} · ${link.textContent?.trim() || url.href}`
    const open = document.createElement('button'); open.textContent = t('openLink'); open.onclick = () => { hideMenus(); window.electronAPI.openExternal(url.href) }
    const copy = document.createElement('button'); copy.textContent = t('copyLink'); copy.onclick = () => { hideMenus(); void navigator.clipboard?.writeText(url.href) }
    surface.append(label, open, copy); showMenu(surface, event.clientX + 12, event.clientY + 12)
    // A stationary pointer must not leave a stale card on screen forever.
    hide(5000)
  })
  editorEl().addEventListener('mouseout', (event) => { if ((event.target as HTMLElement | null)?.closest('a[href]')) hide(140) })
  editorEl().addEventListener('scroll', () => hideMenus(), { passive: true })
}

async function exportCurrent(format: ExportFormat): Promise<void> {
  const session = activeSession(); if (!session) return
  snapshotActive(); if (session.mode !== 'wysiwyg') replaceEditorMarkdown(session, session.content)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await window.electronAPI.exportDocument(format, buildExportDocument(editorEl(), session.displayName.replace(/\.[^.]+$/, '') || t('untitled')))
}

async function pasteImage(file: File): Promise<void> {
  if (windowCloseSaveInProgress) return
  const session = activeSession(); if (!session) return
  if (!session.path && !await saveSession(session, false, true)) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const source = await window.electronAPI.saveClipboardImageForDocument(session.documentId, bytes, file.type)
  if (!source) return
  if (activeSession() === session) insertImageMarkdown(source, file.name || 'Pasted image')
  else markSessionChanged(session, `${session.content}${session.content.endsWith('\n') ? '' : '\n'}\n![${file.name || 'Pasted image'}](${source})\n`)
}

async function insertImageFromPicker(): Promise<void> {
  if (windowCloseSaveInProgress) return
  const session = activeSession()
  if (!session) return
  if (!session.path && !await saveSession(session, false, true)) return
  const source = await window.electronAPI.chooseImageForDocument(session.documentId)
  if (!source || activeSession() !== session) return
  insertImageMarkdown(source, source.split('/').pop() || t('insertImage'))
}

async function applyExternalDocumentChange(data: { documentId: string; content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string }): Promise<void> {
  const session = sessions.get(data.documentId)
  if (!session) return
  const pathAtEvent = session.path
  // A pending Save As destination belongs to a different disk identity. Clear
  // it before this original-document event becomes the visible conflict, so
  // Keep Mine can never accidentally force the old destination.
  const staleTarget = conflictTargetToCancel(
    session.pendingSaveTarget, session.conflict?.target, data.target,
    session.pendingSaveTargetKey, session.conflict?.targetKey, data.targetKey,
  )
  if (staleTarget) {
    await window.electronAPI.cancelSaveConflict(session.documentId, staleTarget)
    if (session.pendingSaveTarget === staleTarget) { session.pendingSaveTarget = null; session.pendingSaveTargetKey = null }
    if (session.conflict?.target === staleTarget) session.conflict = null
    session.forceOverwrite = false
  }
  // A force retry can have completed while cancellation IPC was in flight.
  // The old watcher event must not be applied to its new save destination.
  if (session.path !== pathAtEvent) return
  if (session.dirty) {
    // Main registers the exact conflicted disk identity before delivering this
    // event. Keeping it here makes ordinary watcher Keep Mine retry that path.
    session.pendingSaveTarget = data.target ?? null
    session.pendingSaveTargetKey = data.targetKey ?? null
    session.forceOverwrite = false
    session.conflict = { content: data.content, revision: data.revision, deleted: data.deleted, target: data.target, targetKey: data.targetKey }
    if (session === activeSession()) renderConflict()
    return
  }
  session.conflict = null
  session.content = data.content
  session.lastSavedContent = data.content
  session.revision = data.revision
  session.deleted = Boolean(data.deleted)
  if (session === activeSession()) applySession(session)
  scheduleTasks(); scheduleOutline()
}

async function init(): Promise<void> {
  const api = window.electronAPI
  api.onFullscreenChanged(setFullscreenUi)
  setFullscreenUi(await api.getFullscreenState())
  api.onCodexBridgeRequest(handleCodexBridgeRequest)
  api.onCodexConnectionStatus(setCodexConnected)
  setRendererLanguage(await api.getLanguage())
  appSettings = await api.getAppSettings()
  if (localStorage.getItem('quillmesh-settings-migrated') !== '1') {
    appSettings = await api.updateAppSettings({ theme: loadSavedTheme(), autosave: localStorage.getItem('colamd-autosave') === '1' })
    localStorage.setItem('quillmesh-settings-migrated', '1')
  }
  applyAppSettings(appSettings)
  refreshStaticLabels()
  setCodexConnected(await api.getCodexConnectionStatus())
  api.onLanguageChanged((language) => { setRendererLanguage(language); refreshStaticLabels(); renderTabs(); renderRecent(); renderConflict(); scheduleStatus(); scheduleTasks(); updateCodexChrome(); if (!codexMenuEl().hidden) renderCodexMenu(); if (reviewMode) renderReview() })
  api.onAppSettingsChanged((settings) => { applyAppSettings(settings); void applyThemeSetting(settings.theme) })
  await applyThemeSetting(appSettings.theme)
  const recordWysiwygChange = (markdown: string): void => {
    const session = activeSession()
    if (!session) return
    const expected = pendingProgrammaticMarkdown
    // `applyingDocument` only spans the synchronous replaceAll call, during
    // which no user event can interleave. Every later real transaction is
    // compared with the exact programmatic result rather than a time window.
    if (applyingDocument) return
    if (expected?.documentId === session.documentId && expected.markdown === markdown) {
      if (!applyingDocument) pendingProgrammaticMarkdown = null
      return
    }
    if (expected?.documentId === session.documentId) pendingProgrammaticMarkdown = null
    markSessionChanged(session, markdown)
    // This is the WYSIWYG -> source half of split synchronization. Programmatic
    // value assignment does not emit an input event, so it cannot loop back.
    if (session.mode === 'split') sourceEl().value = mirrorWysiwygToSource(sourceEl().value, markdown)
    applyHeadingCollapse(session.collapsedHeadings); applyCodeWrap(session.codeWrap); updateSlashMenu()
  }
  // Do not bind Milkdown's debounced markdownUpdated callback here: after a
  // tab switch it can describe the previous document. The transaction hook
  // below serializes the current view synchronously instead.
  await createEditor('editor')
  // ProseMirror receives a few custom key/paste handlers from editor.ts. The
  // capture gate prevents those programmatic mutations while a window-close
  // save has frozen the view; already accepted input was snapshotted first.
  for (const type of ['beforeinput', 'paste', 'cut', 'keydown']) {
    editorEl().addEventListener(type, (event) => {
      if (!windowCloseSaveInProgress) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, true)
  }
  // The transaction hook gives immediate dirty/main-process protection for
  // typing, table commands, formatting, image inserts, and task toggles.
  window.addEventListener('colamd-document-changed', () => recordWysiwygChange(getMarkdown()))
  setImagePasteHandler(pasteImage)
  outlinePanel = new OutlinePanel(editorEl(), document.getElementById('outline-list') as HTMLElement, document.getElementById('outline-empty') as HTMLElement, moveHeadingSection, revealHeadingFromOutline)
  const search = new SearchPanel(); registerCommands(search)
  const options = await api.getViewOptions(); document.body.classList.toggle('focus-mode', options.focusMode); document.body.classList.toggle('typewriter-mode', options.typewriterMode); document.body.classList.toggle('show-equation-numbers', options.equationNumbering)
  ;(document.getElementById('autosave-btn') as HTMLButtonElement).addEventListener('click', () => {
    void updateSettings({ autosave: !appSettings.autosave })
  })
  ;(document.getElementById('split-view-btn') as HTMLButtonElement).addEventListener('click', toggleSplitMode); renderAutosave()
  ;(document.getElementById('empty-open-document') as HTMLButtonElement).addEventListener('click', () => { void api.openFile() })
  ;(document.getElementById('empty-new-document') as HTMLButtonElement).addEventListener('click', () => { void api.newDocument() })
  ;(document.getElementById('welcome-recent-list') as HTMLElement).addEventListener('click', (event) => { const path = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-path]')?.dataset.path; if (path) void api.openFilePath(path) })
  codexButtonEl().addEventListener('click', (event) => { event.stopPropagation(); toggleCodexMenu() })
  ;(document.getElementById('settings-btn') as HTMLButtonElement).addEventListener('click', openSettings)
  ;(document.getElementById('welcome-settings-btn') as HTMLButtonElement).addEventListener('click', openSettings)
  ;(document.getElementById('settings-close') as HTMLButtonElement).addEventListener('click', closeSettings)
  makeDialogDraggable(document.querySelector<HTMLElement>('#settings-dialog .settings-header') as HTMLElement, document.getElementById('settings-dialog') as HTMLElement)
  ;(document.getElementById('settings-default-app-btn') as HTMLButtonElement).addEventListener('click', async () => {
    const opened = await api.openDefaultAppsSettings()
    ;(document.getElementById('settings-default-app-note') as HTMLElement).textContent = opened ? t('defaultAppInstructions') : t('defaultAppsOpenFailed')
  })
  window.addEventListener('focus', () => { if (!settingsOverlayEl().hidden) void refreshFileAssociationStatus() })
  for (const navItem of document.querySelectorAll<HTMLButtonElement>('.settings-nav-item')) {
    navItem.addEventListener('click', () => {
      const section = navItem.dataset.section
      for (const item of document.querySelectorAll<HTMLElement>('.settings-nav-item')) item.classList.toggle('active', item === navItem)
      for (const panel of document.querySelectorAll<HTMLElement>('.settings-section[data-section]')) panel.classList.toggle('active', panel.dataset.section === section)
    })
  }
  ;(document.getElementById('settings-font') as HTMLSelectElement).addEventListener('change', (event) => { void updateSettings({ editorFont: (event.currentTarget as HTMLSelectElement).value as AppSettings['editorFont'] }) })
  ;(document.getElementById('settings-width') as HTMLSelectElement).addEventListener('change', (event) => { void updateSettings({ contentWidth: (event.currentTarget as HTMLSelectElement).value as AppSettings['contentWidth'] }) })
  const fontSizeControl = document.getElementById('settings-font-size') as HTMLInputElement
  fontSizeControl.addEventListener('input', () => { applyAppSettings({ ...appSettings, fontSize: Number(fontSizeControl.value) }) })
  fontSizeControl.addEventListener('change', () => { void updateSettings({ fontSize: Number(fontSizeControl.value) }) })
  const lineHeightControl = document.getElementById('settings-line-height') as HTMLInputElement
  lineHeightControl.addEventListener('input', () => { applyAppSettings({ ...appSettings, lineHeight: Number(lineHeightControl.value) }) })
  lineHeightControl.addEventListener('change', () => { void updateSettings({ lineHeight: Number(lineHeightControl.value) }) })
  ;(document.getElementById('settings-autosave') as HTMLInputElement).addEventListener('change', (event) => { void updateSettings({ autosave: (event.currentTarget as HTMLInputElement).checked }) })
  ;(document.getElementById('settings-statusbar') as HTMLInputElement).addEventListener('change', (event) => { void updateSettings({ statusBar: (event.currentTarget as HTMLInputElement).checked }) })
  ;(document.getElementById('settings-codex') as HTMLInputElement).addEventListener('change', (event) => { void updateSettings({ codexEnabled: (event.currentTarget as HTMLInputElement).checked }) })
  tabsEl().addEventListener('click', (event) => { const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('.document-tab'); if (!tab?.dataset.documentId) return; if ((event.target as HTMLElement).closest('.tab-close')) void requestCloseTab(tab.dataset.documentId); else void api.activateDocument(tab.dataset.documentId) })
  document.getElementById('file-toggle-btn')?.addEventListener('click', () => commands.execute('view.filePanel'))
  fullscreenViewButtonEl().addEventListener('click', (event) => {
    event.stopPropagation()
    const menu = fullscreenViewMenuEl()
    menu.hidden = !menu.hidden
    fullscreenViewButtonEl().setAttribute('aria-expanded', String(!menu.hidden))
  })
  for (const id of ['fullscreen-menu-exit', 'fullscreen-exit-btn']) document.getElementById(id)?.addEventListener('click', () => api.exitFullscreen())
  for (const tab of ['files', 'outline', 'tasks'] as SidePanelTab[]) document.getElementById(`${tab}-tab`)?.addEventListener('click', () => setPanel(tab))
  setPanel(activePanelTab)
  reviewToggleEl().addEventListener('click', () => setReviewMode(!reviewMode))
  document.getElementById('review-close-btn')?.addEventListener('click', () => setReviewMode(false))
  setReviewMode(reviewMode)
  for (const filter of ['open', 'resolved', 'all'] as ReviewFilter[]) {
    document.getElementById(`review-filter-${filter}`)?.addEventListener('click', () => {
      reviewFilter = filter
      for (const name of ['open', 'resolved', 'all'] as ReviewFilter[]) document.getElementById(`review-filter-${name}`)?.classList.toggle('active', name === filter)
      renderReview()
    })
  }
  onAnnotationsChanged(() => { scheduleCommentMarks(); if (reviewMode) renderReview() })
  window.addEventListener('colamd-document-changed', scheduleCommentMarks)
  fileListEl().addEventListener('click', (event) => { const path = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-path]')?.dataset.path; const session = activeSession(); if (path && session) void api.openSibling(session.documentId, path) })
  ;(document.getElementById('tasks-open-only') as HTMLInputElement).addEventListener('change', renderTasks)
  ;(document.getElementById('tasks-list') as HTMLElement).addEventListener('click', (event) => { const text = (event.target as HTMLElement).closest<HTMLButtonElement>('.task-item')?.dataset.task; if (!text) return; Array.from(editorEl().querySelectorAll('li[data-item-type="task"]')).find((item) => item.textContent?.includes(text))?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
  sourceEl().addEventListener('focus', () => { lastCodexSelectionSurface = 'source' })
  sourceEl().addEventListener('input', () => {
    const session = activeSession()
    // Programmatic textarea mirroring does not emit input. Every real source
    // event is therefore authoritative, including rapid events during a prior
    // split render frame.
    if (!session) return
    markSessionChanged(session, sourceEl().value)
    if (session.mode === 'split') scheduleSplitSourceRender(session)
  })
  sourceEl().addEventListener('scroll', () => { if (activeSession()?.mode === 'split') syncScroll(sourceEl(), editorEl()) }, { passive: true })
  editorEl().addEventListener('scroll', () => { if (activeSession()?.mode === 'split') syncScroll(editorEl(), sourceEl()) }, { passive: true })
  editorEl().addEventListener('focusin', () => { lastCodexSelectionSurface = 'wysiwyg'; scheduleLongDocumentPaint() })
  editorEl().addEventListener('focusout', () => setTimeout(scheduleLongDocumentPaint, 0))
  editorEl().addEventListener('contextmenu', (event) => {
    if (isImageViewerOpen()) return
    const target = event.target as HTMLElement
    const image = target.closest<HTMLImageElement>('img')
    const source = imageMarkdownSourceAt(target)
    if (image && source) { event.preventDefault(); showImageResourceMenu(event, source, image); return }
    const cell = target.closest<HTMLElement>('td,th')
    if (cell) { event.preventDefault(); showTableContextMenu(event, cell); return }
    if (!getEditorView()) return
    event.preventDefault(); showEditorContextMenu(event)
  })
  editorEl().addEventListener('keyup', updateSlashMenu); editorEl().addEventListener('input', updateSlashMenu)
  editorEl().addEventListener('keydown', (event) => {
    if (getSlashQuery() === null) return
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('#slash-command-menu .command-option'))
    if (!options.length) return
    const active = options.findIndex((option) => option.classList.contains('keyboard-active'))
    if (event.key === 'Escape') { event.preventDefault(); clearSlashQuery(); hideMenus(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const next = event.key === 'ArrowDown' ? (active + 1 + options.length) % options.length : (active - 1 + options.length) % options.length
      options.forEach((option, index) => option.classList.toggle('keyboard-active', index === next)); options[next].scrollIntoView({ block: 'nearest' }); return
    }
    if (event.key === 'Enter') { event.preventDefault(); (options[active >= 0 ? active : 0]).click() }
  })
  window.addEventListener('colamd-toggle-heading-collapse', (event) => { const session = activeSession(); const key = (event as CustomEvent<string>).detail; if (!session || !key) return; session.collapsedHeadings.has(key) ? session.collapsedHeadings.delete(key) : session.collapsedHeadings.add(key); applyHeadingCollapse(session.collapsedHeadings) })
  window.addEventListener('colamd-toggle-code-wrap', (event) => { const session = activeSession(); const key = (event as CustomEvent<string>).detail; if (!session || !key) return; session.codeWrap.has(key) ? session.codeWrap.delete(key) : session.codeWrap.add(key); applyCodeWrap(session.codeWrap) })
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openPalette() }
    else if (event.key === 'Escape') {
      if (!settingsOverlayEl().hidden) { event.preventDefault(); closeSettings(); return }
      if (document.body.classList.contains('fullscreen-mode')) { event.preventDefault(); api.exitFullscreen() }
      hideMenus()
    }
  })
  document.addEventListener('click', (event) => { if (!(event.target as HTMLElement).closest('.command-surface,.selection-format-menu,.titlebar-text-btn,.titlebar-recent-btn,.titlebar-codex-btn,.popover-menu,.link-preview')) hideMenus() })
  recentButtonEl().addEventListener('click', () => { const menu = recentMenuEl(); if (menu.hidden) { renderRecent(); showMenu(menu, recentButtonEl().getBoundingClientRect().left, recentButtonEl().getBoundingClientRect().bottom + 4) } else menu.hidden = true })
  recentMenuEl().addEventListener('click', (event) => { const path = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-path]')?.dataset.path; if (path) void api.openFilePath(path) })
  ;(document.getElementById('conflict-compare-btn') as HTMLButtonElement).addEventListener('click', () => { const session = activeSession(); if (!session?.conflict) return; conflictDiffEl().hidden = !conflictDiffEl().hidden; (document.getElementById('conflict-local-content') as HTMLElement).textContent = session.content; (document.getElementById('conflict-external-content') as HTMLElement).textContent = session.conflict.content; (document.getElementById('conflict-local-label') as HTMLElement).textContent = t('myVersion'); (document.getElementById('conflict-external-label') as HTMLElement).textContent = t('externalVersion') })
  ;(document.getElementById('conflict-keep-btn') as HTMLButtonElement).addEventListener('click', () => {
    const session = activeSession(); if (!session?.conflict) return
    // Keep the conflict visible until the one explicit forced overwrite has
    // succeeded. Autosave is intentionally not involved in this decision.
    session.forceOverwrite = true
    void saveSession(session, false, true)
  })
  ;(document.getElementById('conflict-use-external-btn') as HTMLButtonElement).addEventListener('click', () => {
    const session = activeSession(); if (!session?.conflict) return
    const conflict = session.conflict
    if (conflict.pathChanged) {
      // A Save As collision belongs to a different destination. It is not an
      // external update of this tab, so never transplant its content/revision
      // into the original document merely to dismiss the banner.
      void window.electronAPI.cancelSaveConflict(session.documentId, conflict.target)
      session.conflict = null
      session.forceOverwrite = false
      session.pendingSaveTarget = null
      session.pendingSaveTargetKey = null
      renderConflict()
      if (session.dirty) scheduleAutosave(session)
      return
    }
    session.content = conflict.content
    session.lastSavedContent = session.content
    session.revision = conflict.revision
    session.deleted = Boolean(conflict.deleted)
    if (conflict.target) void window.electronAPI.cancelSaveConflict(session.documentId, conflict.target)
    session.conflict = null
    session.forceOverwrite = false
    session.pendingSaveTarget = null
    session.pendingSaveTargetKey = null
    setDirty(session, false)
    applySession(session)
    renderConflict()
  })
  installLinkPreview()
  api.onDocumentActivated((data) => activateSession(data.documentId, data))
  api.onDocumentExternalChange((data) => { void applyExternalDocumentChange(data) })
  api.onRecentFilesChanged((files) => { recent = files; renderRecent() }); recent = await api.getRecentFiles(); renderRecent()
  api.onCommandId((id) => commands.execute(id))
  api.onSaveBeforeClose(() => { void saveAllBeforeWindowClose() })
  api.onAgentActivity((state) => { const dot = document.getElementById('agent-dot'); if (dot) dot.className = state === 'idle' ? '' : state })
  api.onSiblingsChanged((data) => { if (data.documentId === activeDocumentId) void refreshSiblings() })
  api.onSetTheme((value) => { void updateSettings({ theme: value }) }); api.onSetCustomCSS((css) => applyTheme(loadSavedTheme(), css)); api.onMenuImportTheme(async () => { const value = await api.loadCustomTheme(); if (value) { applyTheme(`custom:${value.name}`, value.css); await updateSettings({ theme: `custom:${value.name}` }) } })
  api.onToggleFocusMode((value) => document.body.classList.toggle('focus-mode', value)); api.onToggleTypewriterMode((value) => document.body.classList.toggle('typewriter-mode', value)); api.onToggleStatusBar((value) => document.body.classList.toggle('show-status-bar', value)); api.onToggleEquationNumbering((value) => document.body.classList.toggle('show-equation-numbers', value))
  document.addEventListener('dragover', (event) => event.preventDefault()); document.addEventListener('drop', (event) => { event.preventDefault(); const file = event.dataTransfer?.files[0]; const path = file ? api.getPathForFile(file) : ''; if (path) void api.openFilePath(path) })
  api.rendererReady()
}

function renderAutosave(): void { const button = document.getElementById('autosave-btn') as HTMLButtonElement; button.textContent = autosaveEnabled ? t('autosaveOn') : t('autosaveOff'); button.setAttribute('aria-pressed', String(autosaveEnabled)) }
function refreshStaticLabels(): void {
  ;(document.getElementById('codex-btn-label') as HTMLElement).textContent = t('codex')
  const settingsButton = document.getElementById('settings-btn') as HTMLButtonElement
  settingsButton.title = t('settings'); settingsButton.setAttribute('aria-label', t('settings'))
  const welcomeSettingsButton = document.getElementById('welcome-settings-btn') as HTMLButtonElement
  welcomeSettingsButton.title = t('settings'); welcomeSettingsButton.setAttribute('aria-label', t('settings'))
  ;(document.getElementById('settings-title') as HTMLElement).textContent = t('settings')
  ;(document.getElementById('settings-description') as HTMLElement).textContent = t('settingsDescription')
  ;(document.getElementById('settings-appearance-title') as HTMLElement).textContent = t('appearance')
  ;(document.getElementById('settings-editor-title') as HTMLElement).textContent = t('editorSettings')
  ;(document.getElementById('settings-files-title') as HTMLElement).textContent = t('filesSettings')
  ;(document.getElementById('settings-default-app-label') as HTMLElement).textContent = t('defaultMarkdownApp')
  ;(document.getElementById('settings-default-app-status') as HTMLElement).textContent = t('checkingDefaultApp')
  ;(document.getElementById('settings-default-app-btn') as HTMLElement).textContent = t('manageDefaultApps')
  ;(document.getElementById('settings-default-app-note') as HTMLElement).textContent = t('defaultAppInstructions')
  ;(document.getElementById('settings-integrations-title') as HTMLElement).textContent = t('integrations')
  ;(document.getElementById('settings-nav-appearance') as HTMLElement).textContent = t('appearance')
  ;(document.getElementById('settings-nav-editor') as HTMLElement).textContent = t('editorSettings')
  ;(document.getElementById('settings-nav-files') as HTMLElement).textContent = t('filesSettings')
  ;(document.getElementById('settings-nav-integrations') as HTMLElement).textContent = t('integrations')
  ;(document.getElementById('settings-theme-label') as HTMLElement).textContent = t('theme')
  ;(document.getElementById('settings-font-label') as HTMLElement).textContent = t('editorFont')
  ;(document.getElementById('settings-font-size-label') as HTMLElement).textContent = t('fontSize')
  ;(document.getElementById('settings-line-height-label') as HTMLElement).textContent = t('lineSpacing')
  ;(document.getElementById('settings-width-label') as HTMLElement).textContent = t('pageWidth')
  ;(document.getElementById('settings-autosave-label') as HTMLElement).textContent = t('autosaveOn').replace(/[:：].*$/, '')
  ;(document.getElementById('settings-autosave-description') as HTMLElement).textContent = t('autosaveDescription')
  ;(document.getElementById('settings-statusbar-label') as HTMLElement).textContent = t('showStatusBar')
  ;(document.getElementById('settings-statusbar-description') as HTMLElement).textContent = t('statusBarDescription')
  ;(document.getElementById('settings-codex-label') as HTMLElement).textContent = t('codexIntegration')
  ;(document.getElementById('settings-codex-description') as HTMLElement).textContent = t('codexIntegrationDescription')
  ;(document.getElementById('settings-codex-note') as HTMLElement).textContent = t('codexOffByDefault')
  const optionLabels: Record<string, string> = { elegant: t('elegant'), light: t('light'), dark: t('dark'), newsprint: t('newsprint'), theme: t('followTheme'), sans: t('sansSerif'), serif: t('serif'), mono: t('monospace'), compact: t('compactWidth'), comfortable: t('comfortableWidth'), wide: t('wideWidth'), fluid: t('fluidWidth') }
  for (const option of document.querySelectorAll<HTMLOptionElement>('#settings-dialog option')) if (optionLabels[option.value]) option.textContent = optionLabels[option.value]
  const closeButton = document.getElementById('settings-close') as HTMLButtonElement
  closeButton.title = t('close'); closeButton.setAttribute('aria-label', t('close'))
  recentButtonEl().title = t('recentFiles')
  recentButtonEl().setAttribute('aria-label', t('recentFiles'))
  ;(document.getElementById('tasks-tab') as HTMLElement).textContent = t('tasks')
  const reviewToggle = document.getElementById('review-toggle-btn') as HTMLButtonElement
  reviewToggle.title = t('reviewMode'); reviewToggle.setAttribute('aria-label', t('reviewMode'))
  ;(document.getElementById('review-panel-title') as HTMLElement).textContent = t('review')
  ;(document.getElementById('review-filter-open') as HTMLElement).textContent = t('reviewOpen')
  ;(document.getElementById('review-filter-resolved') as HTMLElement).textContent = t('reviewResolved')
  ;(document.getElementById('review-filter-all') as HTMLElement).textContent = t('reviewAll')
  ;(document.getElementById('review-empty') as HTMLElement).textContent = t('reviewEmpty')
  ;(document.getElementById('tasks-open-only-label') as HTMLElement).textContent = t('openTasksOnly')
  ;(document.getElementById('tasks-empty') as HTMLElement).textContent = t('noTasks')
  ;(document.getElementById('split-view-btn') as HTMLElement).textContent = t('splitView')
  ;(document.getElementById('welcome-tagline') as HTMLElement).textContent = t('welcomeTagline')
  ;(document.querySelector('#empty-open-document span') as HTMLElement).textContent = t('openFileAction')
  ;(document.querySelector('#empty-new-document span') as HTMLElement).textContent = t('createNewDocument')
  ;(document.getElementById('welcome-recent-title') as HTMLElement).textContent = t('recentFiles')
  ;(document.getElementById('welcome-drop-hint') as HTMLElement).textContent = t('dropFileHint')
  ;(document.getElementById('conflict-compare-btn') as HTMLElement).textContent = t('compareVersions')
  ;(document.getElementById('conflict-keep-btn') as HTMLElement).textContent = t('keepMine')
  ;(document.getElementById('conflict-use-external-btn') as HTMLElement).textContent = t('useExternal')
  ;(document.getElementById('fullscreen-view-label') as HTMLElement).textContent = t('view')
  ;(document.getElementById('fullscreen-menu-exit-label') as HTMLElement).textContent = t('exitFullscreen')
  ;(document.getElementById('fullscreen-exit-hint') as HTMLElement).textContent = t('fullscreenExitHint')
  ;(document.getElementById('fullscreen-exit-btn') as HTMLElement).textContent = t('exitFullscreen')
  updateCodexChrome()
  renderWelcomeRecent()
  renderAutosave()
}
init().catch((error) => console.error('QuillMesh init failed:', error))

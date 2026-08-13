import { app, BrowserWindow, clipboard as systemClipboard, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'fs/promises'
import { existsSync, readFileSync, readdirSync, watch } from 'fs'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { languageFromLocale, normalizeLanguage, translate, type AppLanguage, type TranslationKey } from '../shared/i18n'
import { DEFAULT_APP_SETTINGS, mergeAppSettings, normalizeAppSettings, type AppSettings } from '../shared/settings'
import { renderDocx, renderPdf, renderPng } from './document-export'
import { startCodexBridge } from './codex-bridge'
import { isQuillMeshProgId, markdownLaunchPaths, parseRegistryDefaultValue, parseRegistryProgId, type FileAssociationStatus } from './file-association'
import {
  createDocumentId,
  canForceConflictedTarget,
  canonicalPotentialPathKey,
  ensureManagedDirectory,
  isMarkdownPath,
  managedExistingRelativePath,
  managedRelativePath,
  pathExists,
  readDiskDocument,
  revisionsEqual,
  saveDecision,
  type DiskRevision,
  type MainDocumentSession,
} from './document-session'

app.setName('QuillMesh')
app.setAppUserModelId('io.quillmesh.desktop')

const execFileAsync = promisify(execFile)

const themesDir = join(app.getPath('home'), '.colamd', 'themes')
const settingsPath = join(app.getPath('userData'), 'settings.json')
const legacySettingsPath = join(app.getPath('appData'), 'ColaMD', 'settings.json')
const RECENT_LIMIT = 15

let currentLanguage: AppLanguage = 'en'
let settingsCache: Record<string, unknown> = {}
let focusModeEnabled = false
let typewriterModeEnabled = false
let statusBarEnabled = true
let equationNumberingEnabled = true
let appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

function t(key: TranslationKey): string { return translate(currentLanguage, key) }

function initializeLanguage(): void {
  try { settingsCache = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown> }
  catch {
    try { settingsCache = JSON.parse(readFileSync(legacySettingsPath, 'utf-8')) as Record<string, unknown> }
    catch { settingsCache = {} }
  }
  currentLanguage = normalizeLanguage(settingsCache.language) ?? languageFromLocale(app.getLocale())
  equationNumberingEnabled = settingsCache.equationNumbering !== false
  appSettings = normalizeAppSettings(settingsCache)
  statusBarEnabled = appSettings.statusBar
}

function saveSettings(): void {
  void mkdir(dirname(settingsPath), { recursive: true })
    .then(() => writeFile(settingsPath, `${JSON.stringify(settingsCache, null, 2)}\n`, 'utf-8'))
    .catch(() => {})
}

function persistAppSettings(next: AppSettings): void {
  appSettings = next
  Object.assign(settingsCache, next)
  statusBarEnabled = next.statusBar
  saveSettings()
}

function broadcastAppSettings(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('app-settings-changed', appSettings)
}

async function updateApplicationSettings(patch: unknown): Promise<AppSettings> {
  const previous = appSettings
  const next = mergeAppSettings(previous, patch)
  persistAppSettings(next)
  if (previous.statusBar !== next.statusBar) {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('toggle-status-bar', next.statusBar)
  }
  if (previous.codexEnabled !== next.codexEnabled) await syncCodexBridge()
  buildMenu()
  broadcastAppSettings()
  return appSettings
}

function recentFiles(): string[] {
  const values = settingsCache.recentFiles
  if (!Array.isArray(values)) return []
  const keys = new Set<string>()
  return values.filter((value): value is string => {
    if (typeof value !== 'string') return false
    const key = canonicalPathKey(value)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  }).slice(0, RECENT_LIMIT)
}

function rememberRecent(path: string): void {
  const normalized = normalizedPath(path)
  const key = canonicalPathKey(normalized)
  settingsCache.recentFiles = [normalized, ...recentFiles().filter((item) => canonicalPathKey(item) !== key)].slice(0, RECENT_LIMIT)
  saveSettings()
  broadcastRecentFiles()
}

function forgetRecent(path: string): void {
  const key = canonicalPathKey(path)
  const next = recentFiles().filter((item) => canonicalPathKey(item) !== key)
  if (next.length === recentFiles().length) return
  settingsCache.recentFiles = next
  saveSettings()
  broadcastRecentFiles()
}

function broadcastRecentFiles(): void {
  const files = recentFiles().map((path) => ({ path, name: basename(path), missing: !pathExists(path) }))
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('recent-files-changed', files)
}

function setLanguage(language: AppLanguage): void {
  if (currentLanguage === language) return
  currentLanguage = language
  settingsCache.language = language
  saveSettings()
  buildMenu()
  for (const win of BrowserWindow.getAllWindows()) {
    updateTitle(win)
    win.webContents.send('language-changed', language)
  }
}

interface SiblingFile { name: string; path: string }

async function listSiblingFiles(filePath: string): Promise<SiblingFile[]> {
  try {
    return (await readdir(dirname(filePath), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isMarkdownPath(entry.name))
      .map((entry) => ({ name: entry.name, path: join(dirname(filePath), entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch { return [] }
}

function ensureThemesDir(): void {
  if (!existsSync(themesDir)) void mkdir(themesDir, { recursive: true }).catch(() => {})
}

interface WindowState {
  documents: Map<string, MainDocumentSession>
  pathToDocumentId: Map<string, string>
  activeDocumentId: string | null
  siblingsTimer: ReturnType<typeof setTimeout> | null
  agentState: 'idle' | 'active' | 'cooldown'
  lastExternalChange: number
  agentCooldownTimer: ReturnType<typeof setTimeout> | null
  forceClose: boolean
  closePromptOpen: boolean
  initialPath: string | null
  initialContent: string | null
  rendererReady: boolean
  discardCloseDocumentIds: Set<string>
}

const windowStates = new Map<number, WindowState>()
let pendingFilePaths: string[] = []
const pathWriteQueues = new Map<string, Promise<unknown>>()
const bridgeRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let stopCodexBridge: (() => Promise<void>) | null = null
let codexCompanionLastSeen = 0
let codexCompanionStatus = false
let codexCompanionTimer: ReturnType<typeof setInterval> | null = null
const CODEX_COMPANION_TTL_MS = 12_000

function isCodexCompanionConnected(): boolean { return appSettings.codexEnabled && Date.now() - codexCompanionLastSeen < CODEX_COMPANION_TTL_MS }
function publishCodexCompanionStatus(force = false): void {
  const connected = isCodexCompanionConnected()
  if (!force && connected === codexCompanionStatus) return
  codexCompanionStatus = connected
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('codex-connection-status', connected)
}
function markCodexCompanionSeen(): void {
  if (!appSettings.codexEnabled) return
  codexCompanionLastSeen = Date.now()
  publishCodexCompanionStatus()
}

function requestRenderer(win: BrowserWindow, action: 'context' | 'locate' | 'proposal' | 'export-html', payload: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<unknown> {
  if (win.isDestroyed()) return Promise.reject(new Error('QuillMesh window is unavailable.'))
  const requestId = randomUUID()
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => { bridgeRequests.delete(requestId); rejectRequest(new Error(action === 'proposal' ? 'The QuillMesh approval timed out.' : 'QuillMesh did not respond.')) }, timeoutMs)
    bridgeRequests.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer })
    win.webContents.send('codex-bridge-request', { requestId, action, payload })
  })
}

function bridgeWindow(path?: string): BrowserWindow | null {
  if (path) return findWindowForFile(path)
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

function normalizedPath(candidate: string): string {
  const resolved = resolve(candidate)
  // Preserve a sensible path for titles/dialogs. Ownership uses the stronger
  // nearest-real-ancestor identity below, including future Save As targets.
  return resolved
}

/** A stable identity for aliases and Windows' case-insensitive filesystem. */
function canonicalPathKey(candidate: string): string {
  return canonicalPotentialPathKey(candidate)
}

function queuePathWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathWriteQueues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const tracked = run.finally(() => { if (pathWriteQueues.get(key) === tracked) pathWriteQueues.delete(key) })
  pathWriteQueues.set(key, tracked)
  return run
}

function getState(win: BrowserWindow): WindowState {
  let state = windowStates.get(win.id)
  if (!state) {
    state = {
      documents: new Map(), pathToDocumentId: new Map(), activeDocumentId: null,
      siblingsTimer: null, agentState: 'idle', lastExternalChange: 0,
      agentCooldownTimer: null, forceClose: false, closePromptOpen: false,
      initialPath: null, initialContent: null, rendererReady: false, discardCloseDocumentIds: new Set(),
    }
    windowStates.set(win.id, state)
  }
  return state
}

function getWinFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function activeDocument(state: WindowState): MainDocumentSession | null {
  return state.activeDocumentId ? state.documents.get(state.activeDocumentId) ?? null : null
}

function dirtyDocuments(state: WindowState): MainDocumentSession[] {
  return [...state.documents.values()].filter((document) => document.dirty)
}

function stopWatchingDocument(document: MainDocumentSession): void {
  document.watcher?.close()
  document.watcher = null
  if (document.debounceTimer) clearTimeout(document.debounceTimer)
  document.debounceTimer = null
}

function updateTitle(win: BrowserWindow): void {
  const document = activeDocument(getState(win))
  if (!document) { win.setTitle('QuillMesh'); return }
  const label = document.path ? basename(document.path) : t('untitled')
  win.setTitle(`${document.dirty ? '● ' : ''}${label} — QuillMesh`)
}

function sessionPayload(document: MainDocumentSession, content: string): { documentId: string; path: string | null; displayName: string; content: string; revision: DiskRevision | null } {
  return { documentId: document.documentId, path: document.path, displayName: document.path ? basename(document.path) : t('untitled'), content, revision: document.revision }
}

function createUntitledDocument(win: BrowserWindow, content = ''): MainDocumentSession {
  const state = getState(win)
  const document: MainDocumentSession = {
    documentId: createDocumentId(), path: null, revision: null, dirty: false,
    watcher: null, debounceTimer: null, internalWriteUntil: 0, lastExternalChange: 0, deleted: false, pendingSaveTarget: null, pendingForceTarget: null,
  }
  state.documents.set(document.documentId, document)
  activateDocument(win, document.documentId, content)
  return document
}

function activateDocument(win: BrowserWindow, documentId: string, content?: string): boolean {
  const state = getState(win)
  const document = state.documents.get(documentId)
  if (!document) return false
  state.activeDocumentId = documentId
  updateTitle(win)
  if (!win.isDestroyed()) {
    win.webContents.send('document-activated', {
      documentId,
      path: document.path,
      displayName: document.path ? basename(document.path) : t('untitled'),
      content,
      revision: document.revision,
    })
  }
  return true
}

function transitionAgentState(win: BrowserWindow, state: WindowState, next: 'idle' | 'active' | 'cooldown'): void {
  if (state.agentCooldownTimer) clearTimeout(state.agentCooldownTimer)
  state.agentCooldownTimer = null
  state.agentState = next
  if (!win.isDestroyed()) win.webContents.send('agent-activity', next)
  if (next === 'active') state.agentCooldownTimer = setTimeout(() => transitionAgentState(win, state, 'cooldown'), 3000)
  if (next === 'cooldown') state.agentCooldownTimer = setTimeout(() => transitionAgentState(win, state, 'idle'), 2000)
}

function scheduleSiblingsRefresh(win: BrowserWindow, state: WindowState, filePath: string): void {
  if (state.siblingsTimer) clearTimeout(state.siblingsTimer)
  state.siblingsTimer = setTimeout(() => {
    state.siblingsTimer = null
    listSiblingFiles(filePath).then((files) => {
      if (!win.isDestroyed()) win.webContents.send('siblings-changed', { documentId: state.pathToDocumentId.get(canonicalPathKey(filePath)) ?? null, files })
    })
  }, 250)
}

function watchDocument(win: BrowserWindow, document: MainDocumentSession): void {
  stopWatchingDocument(document)
  if (!document.path) return
  const filePath = document.path
  const directory = dirname(filePath)
  const name = basename(filePath)
  let suppressUntil = Date.now() + 300
  let watcher: ReturnType<typeof watch> | null = null
  const isCurrentWatcher = (): boolean => document.path === filePath && document.watcher === watcher && !win.isDestroyed()

  const reload = (): void => {
    if (document.debounceTimer) clearTimeout(document.debounceTimer)
    document.debounceTimer = setTimeout(() => {
      document.debounceTimer = null
      if (!isCurrentWatcher()) return
      void readDiskDocument(filePath).then((disk) => {
        if (!isCurrentWatcher() || revisionsEqual(document.revision, disk.revision)) return
        document.revision = disk.revision
        document.deleted = false
        const conflictTarget = document.dirty ? registerExternalConflict(document, filePath) : undefined
        win.webContents.send('document-external-change', {
          documentId: document.documentId, content: disk.content, revision: disk.revision, deleted: false,
          target: conflictTarget?.target, targetKey: conflictTarget?.targetKey,
        })
      }).catch((error: unknown) => {
        const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
        if (code !== 'ENOENT' || !isCurrentWatcher() || document.deleted) return
        document.revision = null
        document.deleted = true
        const conflictTarget = document.dirty ? registerExternalConflict(document, filePath) : undefined
        win.webContents.send('document-external-change', {
          documentId: document.documentId, content: '', revision: null, deleted: true,
          target: conflictTarget?.target, targetKey: conflictTarget?.targetKey,
        })
      })
    }, 120)
  }

  const scheduleTrailingReload = (until: number): void => {
    if (document.debounceTimer) clearTimeout(document.debounceTimer)
    document.debounceTimer = setTimeout(() => {
      document.debounceTimer = null
      if (!isCurrentWatcher()) return
      changed()
    }, Math.max(0, until - Date.now()) + 25)
  }

  const changed = (): void => {
    const now = Date.now()
    const suppressionEnds = Math.max(document.internalWriteUntil, suppressUntil)
    if (now < suppressionEnds) {
      // fs.watch coalesces events. A trailing validation means an external
      // write arriving in the startup/internal-save grace period is not lost.
      scheduleTrailingReload(suppressionEnds)
      return
    }
    if (!isCurrentWatcher()) return
    const state = getState(win)
    if (now - state.lastExternalChange < 2000) transitionAgentState(win, state, 'active')
    state.lastExternalChange = now
    document.lastExternalChange = now
    reload()
  }

  try {
    watcher = watch(directory, (_eventType, filename) => {
      const changedName = typeof filename === 'string' ? filename : null
      if (changedName && changedName !== name) {
        if (isMarkdownPath(changedName)) scheduleSiblingsRefresh(win, getState(win), filePath)
        return
      }
      changed()
    })
    document.watcher = watcher
    watcher.on('error', () => setTimeout(() => {
      if (isCurrentWatcher()) watchDocument(win, document)
    }, 250))
  } catch {
    // A non-watchable directory merely loses live refresh. Every save still validates its revision.
  }
}

async function openPathInWindow(win: BrowserWindow, candidate: string): Promise<ReturnType<typeof sessionPayload> | null> {
  const filePath = normalizedPath(candidate)
  const key = canonicalPathKey(filePath)
  const state = getState(win)
  const activateExisting = (): ReturnType<typeof sessionPayload> | null => {
    const owner = findOpenDocument(key)
    if (!owner) return null
    owner.win.focus()
    const ownerState = getState(owner.win)
    const existing = ownerState.documents.get(owner.documentId)
    if (!existing) return null
    activateDocument(owner.win, existing.documentId)
    return owner.win === win ? sessionPayload(existing, '') : null
  }
  const existing = activateExisting()
  if (existing || findOpenDocument(key)) return existing
  try {
    const disk = await readDiskDocument(filePath)
    // Concurrent opens can both complete their read. Recheck after I/O so the
    // second continuation reuses the first document identity.
    const afterRead = activateExisting()
    if (afterRead || findOpenDocument(key)) return afterRead
    const document: MainDocumentSession = {
      documentId: createDocumentId(), path: filePath, revision: disk.revision, dirty: false,
      watcher: null, debounceTimer: null, internalWriteUntil: 0, lastExternalChange: 0, deleted: false, pendingSaveTarget: null, pendingForceTarget: null,
    }
    state.documents.set(document.documentId, document)
    state.pathToDocumentId.set(key, document.documentId)
    watchDocument(win, document)
    rememberRecent(filePath)
    activateDocument(win, document.documentId, disk.content)
    return sessionPayload(document, disk.content)
  } catch {
    forgetRecent(filePath)
    return null
  }
}

function closeDocument(win: BrowserWindow, documentId: string, discard = false): boolean {
  const state = getState(win)
  const document = state.documents.get(documentId)
  if (!document) return false
  const tabOrder = [...state.documents.keys()]
  const closedIndex = tabOrder.indexOf(documentId)
  if (document.dirty && (!discard || !state.discardCloseDocumentIds.delete(documentId))) return false
  state.discardCloseDocumentIds.delete(documentId)
  stopWatchingDocument(document)
  if (document.path) state.pathToDocumentId.delete(canonicalPathKey(document.path))
  state.documents.delete(documentId)
  if (state.activeDocumentId === documentId) {
    const remaining = [...state.documents.values()]
    const next = remaining[Math.min(Math.max(0, closedIndex), Math.max(0, remaining.length - 1))]
    if (next) activateDocument(win, next.documentId)
    else state.activeDocumentId = null
  }
  updateTitle(win)
  return true
}

interface SavePayload {
  documentId: string
  content: string
  baseRevision: DiskRevision | null
  force?: boolean
  retryTarget?: string
}

interface SaveResult {
  ok: boolean
  cancelled?: boolean
  conflict?: { content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string; pathChanged?: boolean }
  path?: string
  revision?: DiskRevision
  error?: string
}

function registerExternalConflict(document: MainDocumentSession, target: string): { target: string; targetKey: string } {
  document.pendingSaveTarget = target
  document.pendingForceTarget = target
  return { target, targetKey: canonicalPathKey(target) }
}

async function readDiskIfPresent(path: string): Promise<{ content: string; revision: DiskRevision } | null> {
  try { return await readDiskDocument(path) } catch (error: unknown) {
    const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
    if (code === 'ENOENT') return null
    throw error
  }
}

function findOpenDocument(pathKey: string): { win: BrowserWindow; documentId: string } | null {
  for (const [id, state] of windowStates) {
    const documentId = state.pathToDocumentId.get(pathKey)
    const win = BrowserWindow.fromId(id)
    if (documentId && win) return { win, documentId }
  }
  return null
}

async function saveDocument(
  win: BrowserWindow,
  payload: SavePayload,
  saveAs: boolean,
): Promise<SaveResult> {
  const state = getState(win)
  const document = state.documents.get(payload.documentId)
  if (!document || typeof payload.content !== 'string') return { ok: false, error: 'unknown-document' }
  let target = document.path
  if (payload.retryTarget !== undefined) {
    const retryTarget = normalizedPath(payload.retryTarget)
    if (!document.pendingForceTarget || canonicalPathKey(document.pendingForceTarget) !== canonicalPathKey(retryTarget)) return { ok: false, error: 'invalid-retry-target' }
    target = document.pendingForceTarget
  } else if (saveAs || !target) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestFileName(document, payload.content),
      filters: [{ name: t('markdownFiles'), extensions: ['md'] }, { name: t('allFiles'), extensions: ['*'] }],
    })
    if (result.canceled || !result.filePath) { document.pendingSaveTarget = null; document.pendingForceTarget = null; return { ok: false, cancelled: true } }
    target = normalizedPath(result.filePath)
    document.pendingSaveTarget = target
  }
  if (!target) return { ok: false, error: 'missing-target' }
  target = normalizedPath(target)
  const targetKey = canonicalPathKey(target)
  const owner = findOpenDocument(targetKey)
  if (owner && (owner.win !== win || owner.documentId !== document.documentId)) {
    document.pendingSaveTarget = null
    document.pendingForceTarget = null
    await dialog.showMessageBox(win, { type: 'warning', title: t('saveDestinationInUse'), message: t('saveDestinationInUseMessage'), buttons: [t('ok')], noLink: true })
    return { ok: false, error: 'path-already-open' }
  }

  return queuePathWrite(targetKey, async (): Promise<SaveResult> => {
    const lockedOwner = findOpenDocument(targetKey)
    if (lockedOwner && (lockedOwner.win !== win || lockedOwner.documentId !== document.documentId)) {
      return { ok: false, error: 'path-already-open' }
    }
    const pathChanged = !document.path || canonicalPathKey(document.path) !== targetKey
    const conflict = (disk: { content: string; revision: DiskRevision } | null): SaveResult => {
      // Keep Mine must retry the exact CAS target, whether it came from Save
      // As or from an ordinary same-path external-change conflict.
      registerExternalConflict(document, target)
      return {
        ok: false,
        conflict: { content: disk?.content ?? '', revision: disk?.revision ?? null, deleted: !disk, target, targetKey, pathChanged },
      }
    }
    const validateTarget = async (): Promise<SaveResult | null> => {
      const disk = await readDiskIfPresent(target)
      // Save-time validation protects deletion even if the watcher was
      // unavailable, delayed, or intentionally suppressed.
      const force = canForceConflictedTarget(payload.force, payload.retryTarget, document.pendingForceTarget, target)
      return saveDecision({
        pathChanged, baseRevision: payload.baseRevision, sessionRevision: document.revision,
        deleted: document.deleted, diskRevision: disk?.revision ?? null, force,
      }) === 'write' ? null : conflict(disk)
    }

    let tempPath: string | null = join(dirname(target), `.${basename(target)}.colamd-${randomUUID()}.tmp`)
    try {
      const beforeTemp = await validateTarget()
      if (beforeTemp) return beforeTemp
      await writeFile(tempPath, payload.content, { encoding: 'utf-8', flag: 'wx' })
      // The revalidation immediately precedes rename. Node cannot provide a
      // kernel-level compare-and-swap, but this closes the check/write window
      // to the atomic replacement boundary without ever deleting the target.
      const beforeReplace = await validateTarget()
      if (beforeReplace) return beforeReplace
      document.internalWriteUntil = Date.now() + 500
      await rename(tempPath, target)
      tempPath = null
      const disk = await readDiskDocument(target)
      const previousPath = document.path
      if (previousPath && canonicalPathKey(previousPath) !== targetKey) state.pathToDocumentId.delete(canonicalPathKey(previousPath))
      document.path = normalizedPath(target)
      document.revision = disk.revision
      document.deleted = false
      // Renderer owns the exact post-save buffer comparison. Leave this
      // conservatively dirty until its forced document-state acknowledgement
      // arrives, so a close cannot slip through while typing continued.
      document.pendingSaveTarget = null
      document.pendingForceTarget = null
      state.pathToDocumentId.set(canonicalPathKey(document.path), document.documentId)
      watchDocument(win, document)
      rememberRecent(document.path)
      updateTitle(win)
      return { ok: true, path: document.path, revision: disk.revision }
    } catch {
      return { ok: false, error: 'write-failed' }
    } finally {
      if (tempPath) await unlink(tempPath).catch(() => {})
    }
  })
}

function suggestFileName(document: MainDocumentSession, content: string): string | undefined {
  if (document.path) return basename(document.path)
  const heading = content.match(/^#\s+(.+)/m) ?? content.match(/^(.+)/m)
  return heading?.[1].trim().replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || undefined
}

function createWindow(filePath?: string, initialContent?: string): BrowserWindow {
  const windowIcon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
  const win = new BrowserWindow({
    width: 960, height: 720, minWidth: 600, minHeight: 400, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
    icon: windowIcon,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  })
  const state = getState(win)
  state.initialPath = filePath ?? null
  state.initialContent = initialContent ?? null
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('language-changed', currentLanguage)
    win.webContents.send('toggle-focus-mode', focusModeEnabled)
    win.webContents.send('toggle-typewriter-mode', typewriterModeEnabled)
    win.webContents.send('toggle-status-bar', statusBarEnabled)
    win.webContents.send('toggle-equation-numbering', equationNumberingEnabled)
    win.webContents.send('app-settings-changed', appSettings)
    win.webContents.send('codex-connection-status', isCodexCompanionConnected())
    win.webContents.send('fullscreen-changed', win.isFullScreen())
    broadcastRecentFiles()
    // Document activation waits for the renderer's explicit ready signal so
    // no initial tab payload is lost while Milkdown is still bootstrapping.
  })
  const notifyFullscreen = (): void => {
    if (win.isDestroyed()) return
    if (process.platform !== 'darwin') {
      win.setAutoHideMenuBar(false)
      win.setMenuBarVisibility(true)
    }
    win.webContents.send('fullscreen-changed', win.isFullScreen())
  }
  win.on('enter-full-screen', () => setImmediate(notifyFullscreen))
  win.on('leave-full-screen', () => setImmediate(notifyFullscreen))
  win.on('close', (event) => {
    if (state.forceClose || dirtyDocuments(state).length === 0) return
    event.preventDefault()
    if (state.closePromptOpen) return
    state.closePromptOpen = true
    void promptToSaveBeforeClose(win)
  })
  win.on('closed', () => {
    for (const document of state.documents.values()) stopWatchingDocument(document)
    if (state.agentCooldownTimer) clearTimeout(state.agentCooldownTimer)
    windowStates.delete(win.id)
  })
  updateTitle(win)
  return win
}

async function promptToSaveBeforeClose(win: BrowserWindow): Promise<void> {
  const state = getState(win)
  const result = await dialog.showMessageBox(win, {
    type: 'warning', title: t('unsavedCloseTitle'), message: t('unsavedCloseMessage'),
    detail: `${dirtyDocuments(state).length} ${t('unsavedDocuments')}`,
    buttons: [t('save'), t('dontSave'), t('cancel')], defaultId: 0, cancelId: 2, noLink: true,
  })
  if (win.isDestroyed()) return
  if (result.response === 0) win.webContents.send('save-before-close')
  else if (result.response === 1) { state.forceClose = true; win.close() }
  else state.closePromptOpen = false
}

function findWindowForFile(filePath: string): BrowserWindow | null {
  const key = canonicalPathKey(filePath)
  for (const [id, state] of windowStates) if (state.pathToDocumentId.has(key)) return BrowserWindow.fromId(id) ?? null
  return null
}

function openFile(filePath: string): void {
  const key = canonicalPathKey(filePath)
  const existing = findWindowForFile(filePath)
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    const id = getState(existing).pathToDocumentId.get(key)
    if (id) activateDocument(existing, id)
    return
  }
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) { void openPathInWindow(focused, filePath); return }
  createWindow(filePath)
}

async function queryWindowsProgId(extension: '.md' | '.markdown'): Promise<string | null> {
  const regExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  try {
    const userChoice = await execFileAsync(regExe, ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice`, '/v', 'ProgId'], { windowsHide: true })
    const progId = parseRegistryProgId(userChoice.stdout)
    if (progId) return progId
  } catch { /* Fall back to the effective class registration below. */ }
  try {
    const registeredClass = await execFileAsync(regExe, ['query', `HKCR\\${extension}`, '/ve'], { windowsHide: true })
    return parseRegistryDefaultValue(registeredClass.stdout)
  } catch { return null }
}

async function fileAssociationStatus(): Promise<FileAssociationStatus> {
  if (process.platform !== 'win32') return { supported: false, isDefault: false, mdDefault: false, markdownDefault: false }
  const [mdProgId, markdownProgId] = await Promise.all([queryWindowsProgId('.md'), queryWindowsProgId('.markdown')])
  const mdDefault = isQuillMeshProgId(mdProgId)
  const markdownDefault = isQuillMeshProgId(markdownProgId)
  return { supported: true, isDefault: mdDefault && markdownDefault, mdDefault, markdownDefault }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', (_event, argv, workingDirectory) => {
  const paths = markdownLaunchPaths(argv, app.isPackaged, workingDirectory || process.cwd())
  if (!app.isReady()) { pendingFilePaths.push(...paths); return }
  if (paths.length) {
    for (const path of paths) openFile(path)
    return
  }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) { createWindow(); return }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

// IPC: all file/resource operations below carry documentId. The main process never falls back to the active tab.
ipcMain.on('codex-bridge-response', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const data = payload as { requestId?: unknown; result?: unknown; error?: unknown }
  if (typeof data.requestId !== 'string') return
  const pending = bridgeRequests.get(data.requestId)
  if (!pending) return
  bridgeRequests.delete(data.requestId)
  clearTimeout(pending.timer)
  if (typeof data.error === 'string' && data.error) pending.reject(new Error(data.error))
  else pending.resolve(data.result)
})

ipcMain.on('open-external', (_event, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
})
ipcMain.handle('get-app-settings', () => appSettings)
ipcMain.handle('update-app-settings', (_event, patch: unknown) => updateApplicationSettings(patch))
ipcMain.handle('get-file-association-status', () => fileAssociationStatus())
ipcMain.handle('open-default-apps-settings', async () => {
  if (process.platform !== 'win32') return false
  try {
    await shell.openExternal('ms-settings:defaultapps?registeredAppMachine=QuillMesh')
    return true
  } catch {
    try { await shell.openExternal('ms-settings:defaultapps'); return true }
    catch { return false }
  }
})
ipcMain.handle('get-codex-connection-status', () => isCodexCompanionConnected())
ipcMain.handle('send-to-codex', async (_event, payload: unknown) => {
  if (!appSettings.codexEnabled) return { copied: false, opened: false }
  if (!payload || typeof payload !== 'object') return { copied: false, opened: false }
  const data = payload as { kind?: unknown; path?: unknown; displayName?: unknown; selectedText?: unknown; heading?: unknown; line?: unknown; sectionText?: unknown }
  const kind = data.kind === 'selection' || data.kind === 'section' || data.kind === 'document' ? data.kind : null
  if (!kind) return { copied: false, opened: false }
  const path = typeof data.path === 'string' ? data.path : ''
  const location = `${typeof data.heading === 'string' && data.heading ? `\n当前标题：${data.heading}` : ''}${typeof data.line === 'number' ? `\n光标约在第 ${data.line} 行` : ''}`
  let prompt = ''
  if (kind === 'selection') {
    if (typeof data.selectedText !== 'string' || !data.selectedText.trim()) return { copied: false, opened: false }
    prompt = `使用 QuillMesh Companion 读取当前 QuillMesh 上下文，修改下面的选中文本。先说明修改思路，再把修改作为 QuillMesh Diff 发回原位置；只有我在 QuillMesh 接受后才写入。\n文档：${path || String(data.displayName ?? '')}${location}\n\n选中文本：\n${data.selectedText}`
  } else if (kind === 'section') {
    if (typeof data.sectionText !== 'string' || !data.sectionText.trim()) return { copied: false, opened: false }
    prompt = `使用 QuillMesh Companion 读取当前 QuillMesh 上下文，检查并优化当前章节。先说明建议，再用逐段 QuillMesh Diff 提交修改；不要直接覆盖文件。\n文档：${path || String(data.displayName ?? '')}${location}\n\n当前章节：\n${data.sectionText}`
  } else {
    prompt = `使用 QuillMesh Companion 检查当前 QuillMesh 文档全文。检查 Markdown 结构、公式与编号、表格、引用和图片路径；先列出问题，不要直接修改。需要修改时，用 QuillMesh Diff 逐段提交并等待我接受。\n文档：${path || String(data.displayName ?? '')}${location}`
  }
  systemClipboard.writeText(prompt)
  try { await shell.openExternal('codex://'); return { copied: true, opened: true } } catch { return { copied: true, opened: false } }
})

ipcMain.on('renderer-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const state = getState(win)
  state.rendererReady = true
  if (state.documents.size !== 0) return
  if (state.initialPath) void openPathInWindow(win, state.initialPath)
  else if (state.initialContent !== null) createUntitledDocument(win, state.initialContent)
  else updateTitle(win)
})

ipcMain.on('document-state', (event, payload: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || !payload || typeof payload !== 'object') return
  const data = payload as { documentId?: unknown; dirty?: unknown }
  if (typeof data.documentId !== 'string' || typeof data.dirty !== 'boolean') return
  const state = getState(win)
  const document = state.documents.get(data.documentId)
  if (!document) return
  document.dirty = data.dirty
  if (data.dirty) state.discardCloseDocumentIds.delete(data.documentId)
  if (data.documentId === state.activeDocumentId) updateTitle(win)
  if (process.platform === 'darwin') win.setDocumentEdited(dirtyDocuments(state).length > 0)
})

ipcMain.handle('complete-close-save', (event, saved: unknown): boolean => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || typeof saved !== 'boolean') return false
  const state = getState(win)
  if (!state.closePromptOpen) return false
  if (!saved) { state.closePromptOpen = false; return true }
  // The renderer's save queue is necessary but not sufficient authority to
  // close: main owns the last aggregate dirty state and refuses a stale ack.
  if (dirtyDocuments(state).length > 0) return false
  state.forceClose = true
  win.close()
  return true
})

ipcMain.handle('get-language', () => currentLanguage)
ipcMain.handle('get-view-options', () => ({ focusMode: focusModeEnabled, typewriterMode: typewriterModeEnabled, statusBar: statusBarEnabled, equationNumbering: equationNumberingEnabled }))
ipcMain.handle('get-fullscreen-state', (event) => getWinFromEvent(event)?.isFullScreen() ?? false)
ipcMain.on('toggle-fullscreen', (event) => { const win = BrowserWindow.fromWebContents(event.sender); if (win) win.setFullScreen(!win.isFullScreen()) })
ipcMain.on('exit-fullscreen', (event) => { const win = BrowserWindow.fromWebContents(event.sender); if (win?.isFullScreen()) win.setFullScreen(false) })
ipcMain.handle('get-recent-files', () => recentFiles().map((path) => ({ path, name: basename(path), missing: !pathExists(path) })))

ipcMain.handle('new-document', (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const document = createUntitledDocument(win)
  return sessionPayload(document, '')
})

ipcMain.handle('activate-document', (event, documentId: unknown) => {
  const win = getWinFromEvent(event)
  return Boolean(win && typeof documentId === 'string' && activateDocument(win, documentId))
})

ipcMain.handle('confirm-close-document', async (event, documentId: unknown): Promise<'save' | 'discard' | 'cancel'> => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  if (!win || !document) return 'cancel'
  const result = await dialog.showMessageBox(win, {
    type: 'warning', title: t('unsavedCloseTitle'), message: t('unsavedCloseMessage'),
    buttons: [t('save'), t('dontSave'), t('cancel')], defaultId: 0, cancelId: 2, noLink: true,
  })
  if (result.response === 1) getState(win).discardCloseDocumentIds.add(document.documentId)
  return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
})

ipcMain.handle('close-document', (event, documentId: unknown, discard: unknown) => {
  const win = getWinFromEvent(event)
  return Boolean(win && typeof documentId === 'string' && closeDocument(win, documentId, discard === true))
})

ipcMain.handle('open-file', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, { filters: [{ name: t('markdownFiles'), extensions: ['md', 'markdown', 'mdown', 'mkd'] }, { name: t('textFiles'), extensions: ['txt'] }, { name: t('allFiles'), extensions: ['*'] }], properties: ['openFile'] })
  return result.canceled || !result.filePaths[0] ? null : openPathInWindow(win, result.filePaths[0])
})

ipcMain.handle('open-file-path', (event, filePath: unknown) => {
  const win = getWinFromEvent(event)
  return !win || typeof filePath !== 'string' ? null : openPathInWindow(win, filePath)
})

ipcMain.handle('list-siblings', (event, documentId: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  return document?.path ? listSiblingFiles(document.path) : null
})

ipcMain.handle('open-sibling', (event, documentId: unknown, filePath: unknown) => {
  const win = getWinFromEvent(event)
  if (!win || typeof documentId !== 'string' || typeof filePath !== 'string' || !getState(win).documents.has(documentId)) return null
  return openPathInWindow(win, filePath)
})

ipcMain.handle('save-document', (event, payload: unknown) => {
  const win = getWinFromEvent(event)
  if (!win || !payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' }
  return saveDocument(win, payload as SavePayload, false)
})

ipcMain.handle('save-document-as', (event, payload: unknown) => {
  const win = getWinFromEvent(event)
  if (!win || !payload || typeof payload !== 'object') return { ok: false, error: 'invalid-payload' }
  return saveDocument(win, payload as SavePayload, true)
})

ipcMain.handle('cancel-save-conflict', (event, documentId: unknown, target: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  if (!document || typeof target !== 'string' || !document.pendingForceTarget) return false
  if (canonicalPathKey(document.pendingForceTarget) !== canonicalPathKey(target)) return false
  document.pendingSaveTarget = null
  document.pendingForceTarget = null
  return true
})

const IMAGE_MIME_TYPES: Record<string, string> = { '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }

async function imagePath(document: MainDocumentSession, source: string): Promise<{ path: string; mime: string } | null> {
  if (!document.path) return null
  // Preserve MIME selection from the Markdown resource name. The real target
  // may be an extensionless in-folder symlink, but must still pass the
  // canonical containment check before its bytes can be loaded or revealed.
  const lexicalPath = managedRelativePath(document.path, source)
  if (!lexicalPath) return null
  const path = await managedExistingRelativePath(document.path, source)
  if (!path) return null
  const extension = lexicalPath.slice(lexicalPath.lastIndexOf('.')).toLowerCase()
  return IMAGE_MIME_TYPES[extension] ? { path, mime: IMAGE_MIME_TYPES[extension] } : null
}

ipcMain.handle('load-local-image-for-document', async (event, documentId: unknown, source: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  if (!document || typeof source !== 'string') return null
  const asset = await imagePath(document, source)
  if (!asset) return null
  try {
    const data = await readFile(asset.path)
    return data.byteLength <= 50 * 1024 * 1024 ? `data:${asset.mime};base64,${data.toString('base64')}` : null
  } catch { return null }
})

ipcMain.handle('save-clipboard-image-for-document', async (event, documentId: unknown, bytes: unknown, mime: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  if (!document?.path || typeof mime !== 'string' || !(bytes instanceof Uint8Array)) return null
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' } as Record<string, string>)[mime.toLowerCase()]
  const data = Buffer.from(bytes)
  if (!extension || data.byteLength === 0 || data.byteLength > 50 * 1024 * 1024) return null
  const documentPath = document.path
  try {
    const assets = await ensureManagedDirectory(documentPath, 'assets')
    if (!assets || document.path !== documentPath) return null
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')
    // `wx` makes the generated name an exclusive claim. Two concurrent pastes
    // in the same second retry distinct suffixes instead of overwriting bytes.
    for (let suffix = 0; suffix < 1_000; suffix++) {
      const name = suffix === 0 ? `image-${stamp}.${extension}` : `image-${stamp}-${suffix + 1}.${extension}`
      try {
        // Re-resolve just before every exclusive create: a replaced assets
        // junction cannot redirect an in-flight paste outside this document.
        const verifiedAssets = await ensureManagedDirectory(documentPath, 'assets')
        if (!verifiedAssets || document.path !== documentPath) return null
        await writeFile(join(verifiedAssets, name), data, { flag: 'wx' })
        return `assets/${name}`
      } catch (error: unknown) {
        const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
        if (code !== 'EEXIST') return null
      }
    }
  } catch {}
  return null
})

ipcMain.handle('choose-image-for-document', async (event, documentId: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  if (!win || !document?.path) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: t('insertImage'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const sourcePath = result.filePaths[0]
  const extension = sourcePath.slice(sourcePath.lastIndexOf('.')).toLowerCase()
  if (!IMAGE_MIME_TYPES[extension]) return null
  const documentPath = document.path
  try {
    const data = await readFile(sourcePath)
    if (data.byteLength === 0 || data.byteLength > 50 * 1024 * 1024) return null
    const assets = await ensureManagedDirectory(documentPath, 'assets')
    if (!assets || document.path !== documentPath) return null
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')
    for (let suffix = 0; suffix < 1_000; suffix++) {
      const name = suffix === 0 ? `image-${stamp}${extension}` : `image-${stamp}-${suffix + 1}${extension}`
      try {
        const verifiedAssets = await ensureManagedDirectory(documentPath, 'assets')
        if (!verifiedAssets || document.path !== documentPath) return null
        await writeFile(join(verifiedAssets, name), data, { flag: 'wx' })
        return `assets/${name}`
      } catch (error: unknown) {
        const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
        if (code !== 'EEXIST') return null
      }
    }
  } catch {}
  return null
})

ipcMain.handle('copy-image-bytes', (_event, bytes: unknown, mime: unknown) => {
  if (!(bytes instanceof Uint8Array) || typeof mime !== 'string' || !mime.toLowerCase().startsWith('image/')) return false
  const data = Buffer.from(bytes)
  if (data.byteLength === 0 || data.byteLength > 50 * 1024 * 1024) return false
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) return false
  systemClipboard.writeImage(image)
  return true
})

ipcMain.handle('copy-table', (_event, html: unknown, text: unknown) => {
  if (typeof html !== 'string' || typeof text !== 'string' || html.length > 5_000_000 || text.length > 5_000_000) return false
  systemClipboard.write({ html, text })
  return true
})

ipcMain.on('perform-edit', (event, action: unknown) => {
  if (action === 'cut') event.sender.cut()
  else if (action === 'copy') event.sender.copy()
  else if (action === 'paste') event.sender.paste()
  else if (action === 'delete') event.sender.delete()
})

ipcMain.handle('reveal-resource-for-document', async (event, documentId: unknown, source: unknown) => {
  const win = getWinFromEvent(event)
  const document = win && typeof documentId === 'string' ? getState(win).documents.get(documentId) : null
  const asset = document && typeof source === 'string' ? await imagePath(document, source) : null
  if (!asset || !existsSync(asset.path)) return false
  shell.showItemInFolder(asset.path)
  return true
})

type ExportFormat = 'pdf' | 'png' | 'html' | 'docx'
const exportFormats: Record<ExportFormat, { extension: string; filterName: string }> = { pdf: { extension: 'pdf', filterName: 'PDF' }, png: { extension: 'png', filterName: 'PNG' }, html: { extension: 'html', filterName: 'HTML' }, docx: { extension: 'docx', filterName: 'Word' } }
ipcMain.handle('export-document', async (event, format: unknown, payload: unknown) => {
  const win = getWinFromEvent(event)
  if (!win || !['pdf', 'png', 'html', 'docx'].includes(String(format)) || !payload || typeof payload !== 'object') return false
  const data = payload as { title?: unknown; html?: unknown }
  if (typeof data.title !== 'string' || typeof data.html !== 'string') return false
  const selected = format as ExportFormat
  const config = exportFormats[selected]
  const result = await dialog.showSaveDialog(win, { title: t('exportDocument'), defaultPath: `${data.title.replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || t('untitled')}.${config.extension}`, filters: [{ name: config.filterName, extensions: [config.extension] }] })
  if (result.canceled || !result.filePath) return false
  try {
    const output = selected === 'html' ? data.html : selected === 'pdf' ? await renderPdf(data.html) : selected === 'png' ? await renderPng(data.html) : await renderDocx(data.html, data.title, currentLanguage)
    await writeFile(result.filePath, output)
    shell.showItemInFolder(result.filePath)
    return true
  } catch {
    await dialog.showMessageBox(win, { type: 'error', title: t('exportFailed'), message: t('exportFailedMessage') })
    return false
  }
})

const demoDir = app.isPackaged ? join(process.resourcesPath, 'demo') : join(__dirname, '../../resources/demo')
const cheatsheetPath = app.isPackaged ? join(process.resourcesPath, 'templates', 'cheatsheet.md') : join(__dirname, '../../resources/templates/cheatsheet.md')
ipcMain.handle('open-feature-demo', (event) => {
  const win = getWinFromEvent(event)
  return win ? openPathInWindow(win, join(demoDir, 'changelog.md')) : null
})
ipcMain.handle('load-custom-theme', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, { filters: [{ name: 'CSS', extensions: ['css'] }], properties: ['openFile'] })
  if (result.canceled || !result.filePaths[0]) return null
  try { const name = basename(result.filePaths[0]); await copyFile(result.filePaths[0], join(themesDir, name)); return { name, css: await readFile(join(themesDir, name), 'utf-8') } } catch { return null }
})
ipcMain.handle('load-theme-css', async (_event, fileName: string) => { try { return await readFile(join(themesDir, basename(fileName)), 'utf-8') } catch { return null } })

function sendToFocused(channel: string, ...args: unknown[]): void { BrowserWindow.getFocusedWindow()?.webContents.send(channel, ...args) }

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const command = (label: string, id: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({ label, accelerator, click: () => sendToFocused('command-id', id) })
  const customThemes: Electron.MenuItemConstructorOptions[] = []
  try { for (const file of readdirSync(themesDir).filter((name) => name.endsWith('.css')).sort()) customThemes.push({ label: file.replace(/\.css$/, ''), click: () => { void updateApplicationSettings({ theme: `custom:${file}` }) } }) } catch {}
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: 'QuillMesh', submenu: [{ role: 'about' as const, label: t('about') }, { type: 'separator' as const }, { role: 'hide' as const, label: t('hide') }, { role: 'hideOthers' as const, label: t('hideOthers') }, { role: 'unhide' as const, label: t('showAll') }, { type: 'separator' as const }, { role: 'quit' as const, label: t('quit') }] }] : []),
    { label: t('file'), submenu: [
      command(t('newFile'), 'file.new', 'CmdOrCtrl+N'), command(t('open'), 'file.open', 'CmdOrCtrl+O'), { type: 'separator' },
      command(t('save'), 'file.save', 'CmdOrCtrl+S'), command(t('saveAs'), 'file.saveAs', 'CmdOrCtrl+Shift+S'), command(t('closeTab'), 'file.closeTab', 'CmdOrCtrl+W'), { type: 'separator' },
      { label: t('export'), submenu: [command(t('exportPdf'), 'file.export.pdf'), command(t('exportImage'), 'file.export.png'), command(t('exportHtml'), 'file.export.html'), { type: 'separator' }, command(t('exportWord'), 'file.export.docx')] },
      ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const, label: t('quit') }] : []),
    ] },
    { label: t('edit'), submenu: [
      { role: 'undo', label: t('undo') }, { role: 'redo', label: t('redo') }, { type: 'separator' }, { role: 'cut', label: t('cut') }, { role: 'copy', label: t('copy') }, { role: 'paste', label: t('paste') }, { role: 'selectAll', label: t('selectAll') }, { type: 'separator' },
      command(t('find'), 'editor.search', 'CmdOrCtrl+F'), command(t('commandPalette'), 'editor.palette', 'CmdOrCtrl+Shift+P'), command(t('insertFormula'), 'editor.math', 'CmdOrCtrl+Shift+E'), { type: 'separator' }, command(t('settings'), 'app.settings', 'CmdOrCtrl+,'),
    ] },
    { label: t('format'), submenu: [
      command(t('paragraph'), 'format.paragraph', 'CmdOrCtrl+Alt+0'), { label: t('heading'), submenu: [1, 2, 3, 4, 5, 6].map((level) => command(t(`heading${level}` as TranslationKey), `format.heading-${level}`, `CmdOrCtrl+${level}`)) }, { type: 'separator' },
      command(t('bold'), 'format.strong', 'CmdOrCtrl+B'), command(t('italic'), 'format.emphasis', 'CmdOrCtrl+I'), command(t('link'), 'format.link', 'CmdOrCtrl+K'), command(t('inlineCode'), 'format.inline-code'), command(t('codeFence'), 'format.code-fence'), command(t('quote'), 'format.quote'), command(t('orderedList'), 'format.ordered-list'), command(t('unorderedList'), 'format.unordered-list'), command(t('taskList'), 'format.task-list'), command(t('insertTable'), 'insert.table'),
    ] },
    { label: t('view'), submenu: [
      { role: 'resetZoom', label: t('resetZoom') }, { role: 'zoomIn', label: t('zoomIn') }, { role: 'zoomOut', label: t('zoomOut') }, { type: 'separator' }, command(t('toggleFileList'), 'view.filePanel', 'CmdOrCtrl+Shift+B'), command(t('sourceMode'), 'view.source', 'CmdOrCtrl+/'), command(t('splitView'), 'view.split'),
      { label: t('focusMode'), type: 'checkbox', checked: focusModeEnabled, click: (item) => { focusModeEnabled = item.checked; sendToFocused('toggle-focus-mode', item.checked) } },
      { label: t('typewriterMode'), type: 'checkbox', checked: typewriterModeEnabled, click: (item) => { typewriterModeEnabled = item.checked; sendToFocused('toggle-typewriter-mode', item.checked) } },
      { label: t('showStatusBar'), type: 'checkbox', checked: statusBarEnabled, click: (item) => { void updateApplicationSettings({ statusBar: item.checked }) } },
      { label: t('toggleFullscreen'), accelerator: isMac ? 'Ctrl+Command+F' : 'F11', click: () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.setFullScreen(!win.isFullScreen()) } },
    ] },
    { label: t('theme'), submenu: [{ label: t('light'), click: () => { void updateApplicationSettings({ theme: 'light' }) } }, { label: t('dark'), click: () => { void updateApplicationSettings({ theme: 'dark' }) } }, { label: t('elegant'), click: () => { void updateApplicationSettings({ theme: 'elegant' }) } }, { label: t('newsprint'), click: () => { void updateApplicationSettings({ theme: 'newsprint' }) } }, ...customThemes, { type: 'separator' }, { label: t('importTheme'), click: () => sendToFocused('menu-import-theme') }] },
    { label: t('language'), submenu: [{ label: t('simplifiedChinese'), type: 'radio', checked: currentLanguage === 'zh-CN', click: () => setLanguage('zh-CN') }, { label: t('english'), type: 'radio', checked: currentLanguage === 'en', click: () => setLanguage('en') }] },
    { label: t('help'), submenu: [command(t('featureDemo'), 'help.demo'), { label: t('cheatsheet'), click: async () => { try { createWindow(undefined, await readFile(cheatsheetPath, 'utf-8')) } catch { createWindow() } } }, { label: t('about'), click: () => { const detail = currentLanguage === 'zh-CN' ? `织墨——面向人类与 AI Agent 协作的本地 Markdown 编辑器。\n\n版本 ${app.getVersion()}\n基于 ColaMD 修改，依 MIT 许可证发布。` : `A local Markdown editor for people and AI agents.\n\nVersion ${app.getVersion()}\nDerived from ColaMD and distributed under the MIT License.`; void dialog.showMessageBox({ type: 'info', title: 'QuillMesh', message: 'QuillMesh', detail }) } }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function syncCodexBridge(): Promise<void> {
  if (!app.isReady()) return
  if (!appSettings.codexEnabled) {
    if (codexCompanionTimer) clearInterval(codexCompanionTimer)
    codexCompanionTimer = null
    codexCompanionLastSeen = 0
    codexCompanionStatus = false
    const stop = stopCodexBridge
    stopCodexBridge = null
    if (stop) await stop().catch(() => {})
    else await unlink(join(app.getPath('userData'), 'codex-bridge.json')).catch(() => {})
    publishCodexCompanionStatus(true)
    return
  }
  if (stopCodexBridge) return
  const statePath = join(app.getPath('userData'), 'codex-bridge.json')
  const stop = await startCodexBridge(statePath, {
    context: async () => {
      markCodexCompanionSeen()
      const win = bridgeWindow()
      if (!win) throw new Error('No QuillMesh window is open.')
      return requestRenderer(win, 'context')
    },
    companionStatus: async (payload) => {
      markCodexCompanionSeen()
      return { connected: true, version: typeof payload.version === 'string' ? payload.version : null }
    },
    open: async (payload) => {
      markCodexCompanionSeen()
      const path = typeof payload.path === 'string' ? normalizedPath(payload.path) : ''
      if (!path || !isMarkdownPath(path)) throw new Error('A Markdown path is required.')
      let win = bridgeWindow(path) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) win = createWindow()
      const opened = await openPathInWindow(win, path)
      if (!opened) throw new Error('Unable to open the Markdown document.')
      win.show(); win.focus()
      await requestRenderer(win, 'locate', { path, heading: payload.heading, line: payload.line })
      return { opened: true, documentId: opened.documentId, path }
    },
    propose: async (payload) => {
      markCodexCompanionSeen()
      const path = typeof payload.path === 'string' ? normalizedPath(payload.path) : ''
      const win = bridgeWindow(path)
      if (!win) throw new Error('Open the document in QuillMesh before proposing a change.')
      win.show(); win.focus()
      return requestRenderer(win, 'proposal', payload, 10 * 60_000)
    },
    refresh: async (payload) => {
      markCodexCompanionSeen()
      const path = typeof payload.path === 'string' ? normalizedPath(payload.path) : ''
      const win = bridgeWindow(path)
      if (!win) return { refreshed: false }
      const state = getState(win)
      const documentId = state.pathToDocumentId.get(canonicalPathKey(path))
      const session = documentId ? state.documents.get(documentId) : null
      if (!session || session.dirty) return { refreshed: false, dirty: Boolean(session?.dirty) }
      const disk = await readDiskDocument(path)
      session.revision = disk.revision; session.deleted = false
      win.webContents.send('document-external-change', { documentId, content: disk.content, revision: disk.revision, deleted: false })
      return { refreshed: true, revision: disk.revision.value }
    },
    exportDocument: async (payload) => {
      markCodexCompanionSeen()
      const format = String(payload.format ?? '') as ExportFormat
      const target = typeof payload.targetPath === 'string' ? resolve(payload.targetPath) : ''
      if (!['pdf', 'png', 'html', 'docx'].includes(format) || !target || !isAbsolute(target)) throw new Error('A supported format and absolute targetPath are required.')
      if (extname(target).toLowerCase() !== `.${exportFormats[format].extension}`) throw new Error(`Target must end in .${exportFormats[format].extension}.`)
      if (existsSync(target) && payload.overwrite !== true) throw new Error('The export target already exists. Pass overwrite: true only after the user confirms replacement.')
      const requestedPath = typeof payload.path === 'string' ? normalizedPath(payload.path) : null
      const win = bridgeWindow(requestedPath ?? undefined)
      if (!win) throw new Error('No QuillMesh window is open.')
      if (requestedPath && !await openPathInWindow(win, requestedPath)) throw new Error('Unable to activate the requested document.')
      const document = await requestRenderer(win, 'export-html', payload) as { title?: unknown; html?: unknown }
      if (typeof document.html !== 'string') throw new Error('Unable to prepare the document export.')
      const title = typeof document.title === 'string' ? document.title : 'QuillMesh'
      const output = format === 'html' ? document.html : format === 'pdf' ? await renderPdf(document.html) : format === 'png' ? await renderPng(document.html) : await renderDocx(document.html, title, currentLanguage)
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, output)
      return { exported: true, path: target, format }
    },
  }).catch(() => null)
  if (!stop) return
  if (!appSettings.codexEnabled) { await stop().catch(() => {}); return }
  stopCodexBridge = stop
  codexCompanionTimer ??= setInterval(() => publishCodexCompanionStatus(), 3_000)
  publishCodexCompanionStatus(true)
}

app.whenReady().then(async () => {
  initializeLanguage(); ensureThemesDir(); buildMenu()
  pendingFilePaths.push(...markdownLaunchPaths(process.argv, app.isPackaged, process.cwd()))
  if (pendingFilePaths.length) { for (const filePath of pendingFilePaths) createWindow(filePath); pendingFilePaths = [] } else createWindow()
  await syncCodexBridge()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('before-quit', () => { if (codexCompanionTimer) clearInterval(codexCompanionTimer); if (stopCodexBridge) void stopCodexBridge() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('open-file', (event, filePath) => { event.preventDefault(); if (app.isReady()) openFile(filePath); else pendingFilePaths.push(filePath) })

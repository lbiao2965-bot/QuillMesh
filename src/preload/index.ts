import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppLanguage } from '../shared/i18n'

export interface SiblingFile { name: string; path: string }
export interface DiskRevision { value: string; mtimeMs: number; size: number }
export interface DocumentPayload { documentId: string; path: string | null; displayName: string; content: string; revision: DiskRevision | null }
export interface RecentFile { path: string; name: string; missing: boolean }
export interface SaveResult { ok: boolean; cancelled?: boolean; conflict?: { content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string; pathChanged?: boolean }; path?: string; revision?: DiskRevision; error?: string }
export type ExportFormat = 'pdf' | 'png' | 'html' | 'docx'
export interface ExportDocumentPayload { title: string; html: string }
export interface CodexBridgeRequest { requestId: string; action: 'context' | 'locate' | 'proposal' | 'export-html'; payload: Record<string, unknown> }
export type CodexSendKind = 'selection' | 'section' | 'document'
export interface CodexSendPayload { kind: CodexSendKind; path: string | null; displayName: string; selectedText?: string; sectionText?: string; heading: string | null; line: number }

export interface ElectronAPI {
  getLanguage: () => Promise<AppLanguage>
  getViewOptions: () => Promise<{ focusMode: boolean; typewriterMode: boolean; statusBar: boolean; equationNumbering: boolean }>
  rendererReady: () => void
  getRecentFiles: () => Promise<RecentFile[]>
  newDocument: () => Promise<DocumentPayload | null>
  activateDocument: (documentId: string) => Promise<boolean>
  closeDocument: (documentId: string, discard?: boolean) => Promise<boolean>
  confirmCloseDocument: (documentId: string) => Promise<'save' | 'discard' | 'cancel'>
  openFile: () => Promise<DocumentPayload | null>
  openFilePath: (path: string) => Promise<DocumentPayload | null>
  openFeatureDemo: () => Promise<DocumentPayload | null>
  listSiblings: (documentId: string) => Promise<SiblingFile[] | null>
  openSibling: (documentId: string, path: string) => Promise<DocumentPayload | null>
  saveDocument: (payload: { documentId: string; content: string; baseRevision: DiskRevision | null; force?: boolean; retryTarget?: string }) => Promise<SaveResult>
  saveDocumentAs: (payload: { documentId: string; content: string; baseRevision: DiskRevision | null; force?: boolean; retryTarget?: string }) => Promise<SaveResult>
  cancelSaveConflict: (documentId: string, target: string | undefined) => Promise<boolean>
  exportDocument: (format: ExportFormat, document: ExportDocumentPayload) => Promise<boolean>
  loadCustomTheme: () => Promise<{ name: string; css: string } | null>
  loadThemeCSS: (fileName: string) => Promise<string | null>
  loadLocalImageForDocument: (documentId: string, source: string) => Promise<string | null>
  saveClipboardImageForDocument: (documentId: string, bytes: Uint8Array, mime: string) => Promise<string | null>
  chooseImageForDocument: (documentId: string) => Promise<string | null>
  copyImageBytes: (bytes: Uint8Array, mime: string) => Promise<boolean>
  copyTable: (html: string, text: string) => Promise<boolean>
  performEdit: (action: 'cut' | 'copy' | 'paste' | 'delete') => void
  revealResourceForDocument: (documentId: string, source: string) => Promise<boolean>
  /** Compatibility-only aliases. New editor code must use document-scoped forms above. */
  loadLocalImage: (source: string) => Promise<string | null>
  saveClipboardImage: (bytes: Uint8Array, mime: string) => Promise<string | null>
  revealResource: (source: string) => Promise<boolean>
  getPathForFile: (file: File) => string
  openExternal: (url: string) => void
  getCodexConnectionStatus: () => Promise<boolean>
  sendToCodex: (payload: CodexSendPayload) => Promise<{ copied: boolean; opened: boolean }>
  setDocumentState: (documentId: string, dirty: boolean) => void
  completeCloseSave: (saved: boolean) => Promise<boolean>
  onDocumentActivated: (callback: (data: DocumentPayload) => void) => void
  onDocumentExternalChange: (callback: (data: { documentId: string; content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string }) => void) => void
  onRecentFilesChanged: (callback: (files: RecentFile[]) => void) => void
  onCommandId: (callback: (id: string) => void) => void
  onSaveBeforeClose: (callback: () => void) => void
  onAgentActivity: (callback: (state: string) => void) => void
  onSiblingsChanged: (callback: (data: { documentId: string | null; files: SiblingFile[] }) => void) => void
  onSetTheme: (callback: (theme: string) => void) => void
  onSetCustomCSS: (callback: (css: string) => void) => void
  onMenuImportTheme: (callback: () => void) => void
  onToggleFocusMode: (callback: (enabled: boolean) => void) => void
  onToggleTypewriterMode: (callback: (enabled: boolean) => void) => void
  onToggleStatusBar: (callback: (enabled: boolean) => void) => void
  onToggleEquationNumbering: (callback: (enabled: boolean) => void) => void
  onLanguageChanged: (callback: (language: AppLanguage) => void) => void
  onCodexConnectionStatus: (callback: (connected: boolean) => void) => void
  onCodexBridgeRequest: (callback: (request: CodexBridgeRequest) => void) => void
  respondCodexBridge: (requestId: string, result: unknown, error?: string) => void
}

let legacyDocumentId: string | null = null

const api: ElectronAPI = {
  getLanguage: () => ipcRenderer.invoke('get-language'),
  getViewOptions: () => ipcRenderer.invoke('get-view-options'),
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  newDocument: () => ipcRenderer.invoke('new-document'),
  activateDocument: (documentId) => ipcRenderer.invoke('activate-document', documentId),
  closeDocument: (documentId, discard = false) => ipcRenderer.invoke('close-document', documentId, discard),
  confirmCloseDocument: (documentId) => ipcRenderer.invoke('confirm-close-document', documentId),
  openFile: () => ipcRenderer.invoke('open-file'),
  openFilePath: (path) => ipcRenderer.invoke('open-file-path', path),
  openFeatureDemo: () => ipcRenderer.invoke('open-feature-demo'),
  listSiblings: (documentId) => ipcRenderer.invoke('list-siblings', documentId),
  openSibling: (documentId, path) => ipcRenderer.invoke('open-sibling', documentId, path),
  saveDocument: (payload) => ipcRenderer.invoke('save-document', payload),
  saveDocumentAs: (payload) => ipcRenderer.invoke('save-document-as', payload),
  cancelSaveConflict: (documentId, target) => ipcRenderer.invoke('cancel-save-conflict', documentId, target),
  exportDocument: (format, document) => ipcRenderer.invoke('export-document', format, document),
  loadCustomTheme: () => ipcRenderer.invoke('load-custom-theme'),
  loadThemeCSS: (fileName) => ipcRenderer.invoke('load-theme-css', fileName),
  loadLocalImageForDocument: (documentId, source) => ipcRenderer.invoke('load-local-image-for-document', documentId, source),
  saveClipboardImageForDocument: (documentId, bytes, mime) => ipcRenderer.invoke('save-clipboard-image-for-document', documentId, bytes, mime),
  chooseImageForDocument: (documentId) => ipcRenderer.invoke('choose-image-for-document', documentId),
  copyImageBytes: (bytes, mime) => ipcRenderer.invoke('copy-image-bytes', bytes, mime),
  copyTable: (html, text) => ipcRenderer.invoke('copy-table', html, text),
  performEdit: (action) => ipcRenderer.send('perform-edit', action),
  revealResourceForDocument: (documentId, source) => ipcRenderer.invoke('reveal-resource-for-document', documentId, source),
  // Compatibility path for the existing image node view. The renderer updates
  // this captured id on every activation, so the actual main IPC still carries
  // a concrete documentId and never consults a window-global file path.
  loadLocalImage: (source) => legacyDocumentId ? ipcRenderer.invoke('load-local-image-for-document', legacyDocumentId, source) : Promise.resolve(null),
  saveClipboardImage: async () => null,
  revealResource: async () => false,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getCodexConnectionStatus: () => ipcRenderer.invoke('get-codex-connection-status'),
  sendToCodex: (payload) => ipcRenderer.invoke('send-to-codex', payload),
  setDocumentState: (documentId, dirty) => { legacyDocumentId = documentId; ipcRenderer.send('document-state', { documentId, dirty }) },
  completeCloseSave: (saved) => ipcRenderer.invoke('complete-close-save', saved),
  onDocumentActivated: (callback) => { ipcRenderer.on('document-activated', (_event, data) => callback(data as DocumentPayload)) },
  onDocumentExternalChange: (callback) => { ipcRenderer.on('document-external-change', (_event, data) => callback(data as { documentId: string; content: string; revision: DiskRevision | null; deleted?: boolean; target?: string; targetKey?: string })) },
  onRecentFilesChanged: (callback) => { ipcRenderer.on('recent-files-changed', (_event, files) => callback(files as RecentFile[])) },
  onCommandId: (callback) => { ipcRenderer.on('command-id', (_event, id) => callback(String(id))) },
  onSaveBeforeClose: (callback) => { ipcRenderer.on('save-before-close', () => callback()) },
  onAgentActivity: (callback) => { ipcRenderer.on('agent-activity', (_event, state) => callback(String(state))) },
  onSiblingsChanged: (callback) => { ipcRenderer.on('siblings-changed', (_event, data) => callback(data as { documentId: string | null; files: SiblingFile[] })) },
  onSetTheme: (callback) => { ipcRenderer.on('set-theme', (_event, theme) => callback(String(theme))) },
  onSetCustomCSS: (callback) => { ipcRenderer.on('set-custom-css', (_event, css) => callback(String(css))) },
  onMenuImportTheme: (callback) => { ipcRenderer.on('menu-import-theme', () => callback()) },
  onToggleFocusMode: (callback) => { ipcRenderer.on('toggle-focus-mode', (_event, enabled) => callback(Boolean(enabled))) },
  onToggleTypewriterMode: (callback) => { ipcRenderer.on('toggle-typewriter-mode', (_event, enabled) => callback(Boolean(enabled))) },
  onToggleStatusBar: (callback) => { ipcRenderer.on('toggle-status-bar', (_event, enabled) => callback(Boolean(enabled))) },
  onToggleEquationNumbering: (callback) => { ipcRenderer.on('toggle-equation-numbering', (_event, enabled) => callback(Boolean(enabled))) },
  onLanguageChanged: (callback) => { ipcRenderer.on('language-changed', (_event, language) => callback(language as AppLanguage)) },
  onCodexConnectionStatus: (callback) => { ipcRenderer.on('codex-connection-status', (_event, connected) => callback(Boolean(connected))) },
  onCodexBridgeRequest: (callback) => { ipcRenderer.on('codex-bridge-request', (_event, request) => callback(request as CodexBridgeRequest)) },
  respondCodexBridge: (requestId, result, error) => ipcRenderer.send('codex-bridge-response', { requestId, result, error }),
}

contextBridge.exposeInMainWorld('electronAPI', api)

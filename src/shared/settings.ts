export type EditorFont = 'theme' | 'sans' | 'serif' | 'mono'
export type ContentWidth = 'compact' | 'comfortable' | 'wide' | 'fluid'

export interface AppSettings {
  codexEnabled: boolean
  theme: string
  editorFont: EditorFont
  fontSize: number
  lineHeight: number
  contentWidth: ContentWidth
  autosave: boolean
  statusBar: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  codexEnabled: false,
  theme: 'elegant',
  editorFont: 'theme',
  fontSize: 16,
  lineHeight: 1.75,
  contentWidth: 'comfortable',
  autosave: false,
  statusBar: true,
}

const editorFonts = new Set<EditorFont>(['theme', 'sans', 'serif', 'mono'])
const contentWidths = new Set<ContentWidth>(['compact', 'comfortable', 'wide', 'fluid'])

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const editorFont = typeof data.editorFont === 'string' && editorFonts.has(data.editorFont as EditorFont)
    ? data.editorFont as EditorFont
    : DEFAULT_APP_SETTINGS.editorFont
  const contentWidth = typeof data.contentWidth === 'string' && contentWidths.has(data.contentWidth as ContentWidth)
    ? data.contentWidth as ContentWidth
    : DEFAULT_APP_SETTINGS.contentWidth
  const theme = typeof data.theme === 'string' && /^(light|dark|elegant|newsprint|custom:[^\\/]+\.css)$/.test(data.theme)
    ? data.theme
    : DEFAULT_APP_SETTINGS.theme
  return {
    codexEnabled: data.codexEnabled === true,
    theme,
    editorFont,
    fontSize: finiteNumber(data.fontSize, DEFAULT_APP_SETTINGS.fontSize, 12, 24),
    lineHeight: finiteNumber(data.lineHeight, DEFAULT_APP_SETTINGS.lineHeight, 1.4, 2.2),
    contentWidth,
    autosave: data.autosave === true,
    statusBar: data.statusBar !== false,
  }
}

export function mergeAppSettings(current: AppSettings, patch: unknown): AppSettings {
  const updates = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
  return normalizeAppSettings({ ...current, ...updates })
}

import { extname, isAbsolute, resolve } from 'path'

export const QUILLMESH_MARKDOWN_PROG_ID = 'QuillMesh.Markdown'
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'] as const

function isAssociatedMarkdownPath(path: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(extname(path).toLocaleLowerCase())
}

export interface FileAssociationStatus {
  supported: boolean
  isDefault: boolean
  mdDefault: boolean
  markdownDefault: boolean
}

export function markdownLaunchPaths(argv: string[], isPackaged: boolean, workingDirectory: string): string[] {
  const start = isPackaged ? 1 : 2
  const seen = new Set<string>()
  const paths: string[] = []
  for (const argument of argv.slice(start)) {
    if (!argument || argument.startsWith('-') || !isAssociatedMarkdownPath(argument)) continue
    const path = isAbsolute(argument) ? resolve(argument) : resolve(workingDirectory, argument)
    const key = process.platform === 'win32' ? path.toLocaleLowerCase() : path
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(path)
  }
  return paths
}

export function parseRegistryProgId(output: string): string | null {
  const match = output.match(/^\s*ProgId\s+REG_\w+\s+(.+?)\s*$/im)
  return match?.[1]?.trim() || null
}

export function parseRegistryDefaultValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*.+?\s+REG_\w+\s+(.+?)\s*$/i)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

export function isQuillMeshProgId(progId: string | null): boolean {
  if (!progId) return false
  const normalized = progId.trim().toLocaleLowerCase()
  return normalized === QUILLMESH_MARKDOWN_PROG_ID.toLocaleLowerCase()
    || normalized === 'applications\\quillmesh.exe'
    || normalized.startsWith('quillmesh.')
}

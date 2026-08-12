import { createHash, randomUUID } from 'crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'path'
import { mkdir, readFile, realpath, stat } from 'fs/promises'
import { existsSync, realpathSync, type FSWatcher } from 'fs'

export interface DiskRevision {
  /** A content-aware revision. mtime and size make the value cheap to inspect; hash closes timestamp races. */
  value: string
  mtimeMs: number
  size: number
}

export interface DiskDocument {
  content: string
  revision: DiskRevision
}

export interface MainDocumentSession {
  documentId: string
  path: string | null
  revision: DiskRevision | null
  dirty: boolean
  watcher: FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  internalWriteUntil: number
  lastExternalChange: number
  deleted: boolean
  /** A Save As destination that conflicted and may only be retried explicitly. */
  pendingSaveTarget: string | null
  /** Main-owned authority token: force is valid only for this conflicted path. */
  pendingForceTarget: string | null
}

export function createDocumentId(): string {
  return randomUUID()
}

export function displayName(path: string | null): string {
  return path ? basename(path) : 'Untitled'
}

export async function readDiskDocument(path: string): Promise<DiskDocument> {
  const [content, info] = await Promise.all([readFile(path, 'utf-8'), stat(path)])
  return { content, revision: revisionFor(content, info.mtimeMs, info.size) }
}

export function revisionFor(content: string, mtimeMs: number, size: number): DiskRevision {
  const digest = createHash('sha256').update(content, 'utf8').digest('hex')
  return { value: `${Math.round(mtimeMs)}:${size}:${digest}`, mtimeMs, size }
}

export function revisionsEqual(left: DiskRevision | null | undefined, right: DiskRevision | null | undefined): boolean {
  return Boolean(left && right && left.value === right.value)
}

type ExistingPathResolver = (candidate: string) => string | null

function realpathIfPresent(candidate: string): string | null {
  try { return realpathSync.native(candidate) } catch { return null }
}

/**
 * Resolve a possible future destination through its nearest existing ancestor.
 * This gives a not-yet-created `alias\\folder\\note.md` the same identity as
 * its real junction/symlink destination without changing the displayed path.
 */
export function canonicalPotentialPath(candidate: string, resolveExisting: ExistingPathResolver = realpathIfPresent): string {
  const resolved = resolve(candidate)
  let ancestor = resolved
  const suffix: string[] = []
  while (true) {
    const realAncestor = resolveExisting(ancestor)
    if (realAncestor) return suffix.reduce((path, segment) => join(path, segment), realAncestor)
    const parent = dirname(ancestor)
    if (parent === ancestor) return resolved
    suffix.unshift(basename(ancestor))
    ancestor = parent
  }
}

/** Stable queue/ownership identity for both existing and future paths. */
export function canonicalPotentialPathKey(candidate: string, resolveExisting: ExistingPathResolver = realpathIfPresent, caseInsensitive = process.platform === 'win32'): string {
  const canonical = canonicalPotentialPath(candidate, resolveExisting)
  return caseInsensitive ? canonical.toLocaleLowerCase() : canonical
}

/** Main-side authority gate for an explicitly conflicted overwrite. */
export function canForceConflictedTarget(force: boolean | undefined, retryTarget: string | undefined, pendingConflictTarget: string | null, target: string): boolean {
  return Boolean(
    force
    && retryTarget
    && pendingConflictTarget
    && canonicalPotentialPathKey(retryTarget) === canonicalPotentialPathKey(pendingConflictTarget)
    && canonicalPotentialPathKey(pendingConflictTarget) === canonicalPotentialPathKey(target),
  )
}

/** The normal (non-force) save decision used immediately before replacement. */
export function saveDecision(input: {
  pathChanged: boolean
  baseRevision: DiskRevision | null
  sessionRevision: DiskRevision | null
  deleted: boolean
  diskRevision: DiskRevision | null
  force?: boolean
}): 'write' | 'conflict' {
  if (input.force) return 'write'
  if (input.pathChanged) return input.diskRevision ? 'conflict' : 'write'
  if (!input.diskRevision) return input.deleted || input.baseRevision !== null || input.sessionRevision !== null ? 'conflict' : 'write'
  return input.baseRevision && revisionsEqual(input.baseRevision, input.diskRevision) ? 'write' : 'conflict'
}

export function isMarkdownPath(path: string): boolean {
  return ['.md', '.markdown', '.mdown', '.mkd'].includes(extname(path).toLowerCase())
}

/** Resolve a managed relative asset without allowing traversal above the document folder. */
export function managedRelativePath(documentPath: string, source: string): string | null {
  const clean = source.trim().split(/[?#]/, 1)[0]
  if (!clean || clean.startsWith('/') || clean.startsWith('\\') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(clean)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(clean).replace(/\\([ ()])/g, '$1')
  } catch {
    return null
  }
  const root = resolve(dirname(documentPath))
  const candidate = resolve(root, decoded)
  const rel = relative(root, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return null
  return candidate
}

/**
 * Check containment after canonicalization. On Windows, a junction can also
 * change drive-letter casing, so this deliberately folds case before deriving
 * the relative path. The candidate itself must be below (not equal to) root.
 */
export function realPathIsWithin(documentDirectory: string, candidate: string, caseInsensitive = process.platform === 'win32'): boolean {
  if (caseInsensitive) {
    const root = win32.resolve(documentDirectory).toLocaleLowerCase()
    const target = win32.resolve(candidate).toLocaleLowerCase()
    const rel = win32.relative(root, target)
    return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${win32.sep}`) && !win32.isAbsolute(rel)
  }
  const root = resolve(documentDirectory)
  const target = resolve(candidate)
  const rel = relative(root, target)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * Resolve an already-existing managed asset through its real filesystem path.
 * The lexical check rejects URLs/traversal first; this second check rejects a
 * symlink or junction beneath the document directory that leads elsewhere.
 */
export async function managedExistingRelativePath(documentPath: string, source: string): Promise<string | null> {
  const lexicalPath = managedRelativePath(documentPath, source)
  if (!lexicalPath) return null
  try {
    const [realDirectory, realTarget] = await Promise.all([
      realpath(resolve(dirname(documentPath))),
      realpath(lexicalPath),
    ])
    return realPathIsWithin(realDirectory, realTarget) ? realTarget : null
  } catch {
    // Loading/revealing requires an existing asset, so unresolved paths fail
    // closed rather than falling back to the lexical path.
    return null
  }
}

/**
 * Create and then realpath-check a managed directory before a resource write.
 * Reusing the same containment rule as resource loading rejects pre-existing
 * `assets` junctions/symlinks that escape the document directory.
 */
export async function ensureManagedDirectory(documentPath: string, directory: string): Promise<string | null> {
  const lexicalPath = managedRelativePath(documentPath, directory)
  if (!lexicalPath) return null
  try {
    await mkdir(lexicalPath, { recursive: true })
    const [realDirectory, realTarget] = await Promise.all([
      realpath(resolve(dirname(documentPath))),
      realpath(lexicalPath),
    ])
    return realPathIsWithin(realDirectory, realTarget) ? realTarget : null
  } catch {
    return null
  }
}

export function pathExists(path: string): boolean {
  return existsSync(path)
}

/**
 * Small, filesystem-free guard used by the main-process contract and the
 * regression smoke test. It documents the only permitted revision outcomes:
 * stale saves conflict, clean external changes target their own session, and
 * conflict sessions are ineligible for autosave.
 */
export class DocumentRevisionGuard {
  private readonly sessions = new Map<string, { revision: DiskRevision | null; dirty: boolean; conflict: boolean; deleted: boolean }>()

  register(documentId: string, revision: DiskRevision | null, dirty = false): void {
    this.sessions.set(documentId, { revision, dirty, conflict: false, deleted: false })
  }

  setDirty(documentId: string, dirty: boolean): void {
    const session = this.sessions.get(documentId)
    if (session) session.dirty = dirty
  }

  checkSave(documentId: string, baseRevision: DiskRevision | null, diskRevision: DiskRevision | null): 'write' | 'conflict' {
    const session = this.sessions.get(documentId)
    if (!session || session.conflict || session.deleted || !diskRevision || !revisionsEqual(baseRevision, diskRevision)) return 'conflict'
    return 'write'
  }

  externalChange(documentId: string, revision: DiskRevision): 'clean-update' | 'conflict' | 'ignored' {
    const session = this.sessions.get(documentId)
    if (!session || revisionsEqual(session.revision, revision)) return 'ignored'
    session.revision = revision
    if (session.dirty) { session.conflict = true; return 'conflict' }
    return 'clean-update'
  }

  externalDeletion(documentId: string): 'clean-update' | 'conflict' | 'ignored' {
    const session = this.sessions.get(documentId)
    if (!session || session.deleted) return 'ignored'
    session.revision = null
    session.deleted = true
    if (session.dirty) { session.conflict = true; return 'conflict' }
    return 'clean-update'
  }

  canAutosave(documentId: string): boolean {
    const session = this.sessions.get(documentId)
    return Boolean(session?.dirty && !session.conflict && !session.deleted)
  }
}

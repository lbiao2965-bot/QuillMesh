import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import katex from 'katex'
import { z } from 'zod'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd'])
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const COMPANION_VERSION = '0.2.2'

interface BridgeState { version: number; port: number; token: string; pid: number }

function bridgeStateCandidates(): string[] {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return [process.env.QUILLMESH_BRIDGE_FILE, join(appData, 'QuillMesh', 'codex-bridge.json'), join(appData, 'quillmesh', 'codex-bridge.json')].filter((value): value is string => Boolean(value))
}

async function bridgeState(): Promise<BridgeState> {
  for (const candidate of bridgeStateCandidates()) {
    try {
      const value = JSON.parse(await readFile(candidate, 'utf8')) as BridgeState
      if (value?.port && value?.token) return value
    } catch {}
  }
  throw new Error('QuillMesh bridge is unavailable. Open QuillMesh and try again.')
}

async function bridgeCall(endpoint: string, payload?: Record<string, unknown>, timeoutMs = 20_000): Promise<any> {
  const state = await bridgeState()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}${endpoint}`, {
      method: payload ? 'POST' : 'GET', headers: { authorization: `Bearer ${state.token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal,
    })
    const data = await response.json() as { ok?: boolean; result?: unknown; error?: string }
    if (!response.ok || !data.ok) throw new Error(data.error || `QuillMesh bridge returned HTTP ${response.status}.`)
    return data.result
  } finally { clearTimeout(timer) }
}

async function waitForBridge(timeoutMs = 12_000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { await bridgeCall('/v1/context', undefined, 1_000); return true } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  }
  return false
}

const server = new McpServer(
  { name: 'quillmesh-companion', version: COMPANION_VERSION },
  { instructions: 'Use inspect_markdown before editing. Every write must include the latest revision returned by inspect_markdown or read_markdown. On revision conflict, stop and show the user the conflict instead of retrying blindly.' },
)

interface FormulaRecord {
  kind: 'inline' | 'block'
  latex: string
  startLine: number
  endLine: number
}

function revisionOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

function maskCodeFences(markdown: string): string {
  return markdown.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (match) => match.replace(/[^\n]/g, ' '))
}

function extractFormulas(markdown: string): FormulaRecord[] {
  const source = maskCodeFences(markdown)
  const formulas: FormulaRecord[] = []
  const consumed: Array<[number, number]> = []
  const add = (kind: FormulaRecord['kind'], latex: string, start: number, end: number): void => {
    consumed.push([start, end])
    formulas.push({ kind, latex: latex.trim(), startLine: lineAt(markdown, start), endLine: lineAt(markdown, end) })
  }
  for (const match of source.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    const start = match.index ?? 0
    add('block', match[1], start, start + match[0].length)
  }
  for (const match of source.matchAll(/\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g)) {
    const start = match.index ?? 0
    if (!consumed.some(([left, right]) => start >= left && start < right)) add('block', match[0], start, start + match[0].length)
  }
  for (const match of source.matchAll(/(?<!\\)(?<!\$)\$(?!\$|\s)([^\n$]*?[^\s$])\$(?!\$)/g)) {
    const start = match.index ?? 0
    if (!consumed.some(([left, right]) => start >= left && start < right)) add('inline', match[1], start, start + match[0].length)
  }
  return formulas.sort((left, right) => left.startLine - right.startLine)
}

async function readMarkdown(candidate: string): Promise<{ path: string; content: string; revision: string }> {
  const path = resolve(candidate)
  if (!MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('Only Markdown files are supported.')
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('Markdown file exceeds the 10 MB safety limit.')
  const content = bytes.toString('utf8')
  return { path, content, revision: revisionOf(content) }
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

function validationFor(formula: FormulaRecord) {
  try {
    katex.renderToString(formula.latex, { displayMode: formula.kind === 'block', throwOnError: true, strict: 'warn', trust: false, output: 'htmlAndMathml' })
    return { ...formula, ok: true as const }
  } catch (error) {
    return { ...formula, ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

function markdownDiagnostics(path: string, markdown: string) {
  const diagnostics: Array<{ severity: 'error' | 'warning' | 'info'; rule: string; line: number; message: string }> = []
  const formulas = extractFormulas(markdown)
  const explicitNumbers = new Map<string, number>()
  for (const formula of formulas) {
    const validation = validationFor(formula)
    if (!validation.ok) diagnostics.push({ severity: 'error', rule: 'formula-syntax', line: formula.startLine, message: validation.error })
    const tag = formula.latex.match(/\\tag\{([^}]+)\}/)?.[1]
    if (tag) {
      if (explicitNumbers.has(tag)) diagnostics.push({ severity: 'error', rule: 'formula-number', line: formula.startLine, message: `Duplicate formula tag ${tag}; first used on line ${explicitNumbers.get(tag)}.` })
      else explicitNumbers.set(tag, formula.startLine)
    }
  }
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const source = match[2].trim().replace(/^<|>$/g, '').split(/\s+["']/, 1)[0]
    if (!/^(?:https?:|data:|file:|#)/i.test(source)) {
      const candidate = resolve(dirname(path), decodeURIComponent(source.replace(/\\([ ()])/g, '$1')))
      if (!existsSync(candidate)) diagnostics.push({ severity: 'error', rule: 'image-path', line: lineAt(markdown, match.index ?? 0), message: `Image does not exist: ${source}` })
    }
    if (!match[1].trim()) diagnostics.push({ severity: 'warning', rule: 'image-alt', line: lineAt(markdown, match.index ?? 0), message: 'Image is missing alternative text.' })
  }
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*\|.*\|\s*$/.test(lines[index]) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const columns = lines[index].split('|').slice(1, -1).length
      const separatorColumns = lines[index + 1].split('|').slice(1, -1).length
      if (columns !== separatorColumns) diagnostics.push({ severity: 'error', rule: 'table-columns', line: index + 2, message: `Table separator has ${separatorColumns} columns; header has ${columns}.` })
      let row = index + 2
      while (row < lines.length && /^\s*\|.*\|\s*$/.test(lines[row])) {
        const count = lines[row].split('|').slice(1, -1).length
        if (count !== columns) diagnostics.push({ severity: 'warning', rule: 'table-columns', line: row + 1, message: `Table row has ${count} columns; expected ${columns}.` })
        row++
      }
    }
    if (/^\s*>\s*$/.test(lines[index])) diagnostics.push({ severity: 'info', rule: 'empty-quote', line: index + 1, message: 'Empty block quote.' })
  }
  return { diagnostics, formulas: formulas.map((formula, index) => ({ ...validationFor(formula), displayNumber: formula.kind === 'block' ? index + 1 : null })) }
}

function safelyNormalizeFormulas(markdown: string): { content: string; changes: Array<{ line: number; message: string }> } {
  const changes: Array<{ line: number; message: string }> = []
  const lines = markdown.split('\n')
  const output: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const standalone = line.match(/^\s*\$([^$\n]+)\$\s*$/)
    if (standalone) {
      output.push('$$', standalone[1].trim(), '$$')
      changes.push({ line: index + 1, message: 'Converted a standalone inline formula to a centered block formula.' })
      continue
    }
    const compactBlock = line.match(/^\s*\$\$\s*(.+?)\s*\$\$\s*$/)
    if (compactBlock) {
      output.push('$$', compactBlock[1].trim(), '$$')
      changes.push({ line: index + 1, message: 'Normalized a one-line block formula to Typora-compatible block syntax.' })
      continue
    }
    output.push(line)
  }
  return { content: output.join('\n'), changes }
}

async function applyPatch(path: string, expectedRevision: string, search: string, replacement: string, occurrence: number) {
  let temporaryDirectory: string | null = null
  try {
    const document = await readMarkdown(path)
    if (document.revision !== expectedRevision.toLowerCase()) return { conflict: true, path: document.path, expectedRevision, actualRevision: document.revision }
    const positions: number[] = []
    for (let index = document.content.indexOf(search); index !== -1; index = document.content.indexOf(search, index + Math.max(1, search.length))) positions.push(index)
    if (positions.length < occurrence) throw new Error(`The requested occurrence ${occurrence} does not exist; found ${positions.length}.`)
    const index = positions[occurrence - 1]
    const next = document.content.slice(0, index) + replacement + document.content.slice(index + search.length)
    temporaryDirectory = await mkdtemp(join(dirname(document.path), '.quillmesh-patch-'))
    const temporaryPath = join(temporaryDirectory, basename(document.path))
    await writeFile(temporaryPath, next, 'utf8')
    const latest = await readMarkdown(document.path)
    if (latest.revision !== expectedRevision.toLowerCase()) return { conflict: true, path: document.path, expectedRevision, actualRevision: latest.revision }
    await rename(temporaryPath, document.path)
    return { conflict: false, path: document.path, previousRevision: expectedRevision.toLowerCase(), revision: revisionOf(next), occurrence, changedCharacters: replacement.length - search.length }
  } finally { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined) }
}

async function applyPatches(path: string, expectedRevision: string, edits: Array<{ search: string; replacement: string; occurrence: number }>) {
  let temporaryDirectory: string | null = null
  try {
    const document = await readMarkdown(path)
    if (document.revision !== expectedRevision.toLowerCase()) return { conflict: true, path: document.path, expectedRevision, actualRevision: document.revision }
    let next = document.content
    for (const [editIndex, edit] of edits.entries()) {
      const positions: number[] = []
      for (let index = next.indexOf(edit.search); index !== -1; index = next.indexOf(edit.search, index + Math.max(1, edit.search.length))) positions.push(index)
      if (positions.length < edit.occurrence) throw new Error(`Edit ${editIndex + 1}: occurrence ${edit.occurrence} does not exist; found ${positions.length}.`)
      const index = positions[edit.occurrence - 1]
      next = next.slice(0, index) + edit.replacement + next.slice(index + edit.search.length)
    }
    temporaryDirectory = await mkdtemp(join(dirname(document.path), '.quillmesh-patch-'))
    const temporaryPath = join(temporaryDirectory, basename(document.path))
    await writeFile(temporaryPath, next, 'utf8')
    const latest = await readMarkdown(document.path)
    if (latest.revision !== expectedRevision.toLowerCase()) return { conflict: true, path: document.path, expectedRevision, actualRevision: latest.revision }
    await rename(temporaryPath, document.path)
    return { conflict: false, path: document.path, previousRevision: expectedRevision.toLowerCase(), revision: revisionOf(next), edits: edits.length, changedCharacters: next.length - document.content.length }
  } finally { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined) }
}

server.registerTool('inspect_markdown', {
  title: 'Inspect Markdown document',
  description: 'Read the structure and revision of a local Markdown file before analysis or editing.',
  inputSchema: { path: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path }) => {
  try {
    const document = await readMarkdown(path)
    const headings = [...document.content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({ level: match[1].length, text: match[2].trim(), line: lineAt(document.content, match.index ?? 0) }))
    const tasks = [...document.content.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/gm)].map((match) => ({ completed: match[1].toLowerCase() === 'x', text: match[2].trim(), line: lineAt(document.content, match.index ?? 0) }))
    const images = [...document.content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((match) => ({ alt: match[1], source: match[2], line: lineAt(document.content, match.index ?? 0) }))
    const formulas = extractFormulas(document.content)
    const data = { path: document.path, name: basename(document.path), revision: document.revision, lines: document.content.split('\n').length, characters: document.content.length, headings, tasks, images, formulas: formulas.map(({ latex, ...formula }) => ({ ...formula, latex })) }
    return { structuredContent: data, content: [{ type: 'text', text: `Inspected ${data.name}: ${data.lines} lines, ${headings.length} headings, ${formulas.length} formulas, revision ${data.revision}.` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('read_markdown', {
  title: 'Read Markdown lines',
  description: 'Read a bounded line range from a Markdown file and return its current revision.',
  inputSchema: { path: z.string().min(1), startLine: z.number().int().min(1).default(1), endLine: z.number().int().min(1).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path, startLine, endLine }) => {
  try {
    const document = await readMarkdown(path)
    const lines = document.content.split('\n')
    const end = Math.min(endLine ?? Math.min(startLine + 399, lines.length), lines.length)
    if (end < startLine) throw new Error('endLine must not be smaller than startLine.')
    const content = lines.slice(startLine - 1, end).map((line, index) => `${startLine + index}: ${line}`).join('\n')
    return { structuredContent: { path: document.path, revision: document.revision, startLine, endLine: end, content }, content: [{ type: 'text', text: content || '(empty range)' }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('validate_formulas', {
  title: 'Validate document formulas',
  description: 'Find LaTeX formulas in a Markdown file and validate each one with KaTeX.',
  inputSchema: { path: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path }) => {
  try {
    const document = await readMarkdown(path)
    const formulas = extractFormulas(document.content).map(validationFor)
    const invalid = formulas.filter((formula) => !formula.ok)
    return { structuredContent: { path: document.path, revision: document.revision, formulas, validCount: formulas.length - invalid.length, invalidCount: invalid.length }, content: [{ type: 'text', text: invalid.length ? `Found ${invalid.length} invalid formula(s) out of ${formulas.length}.` : `All ${formulas.length} formula(s) are valid.` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('get_quillmesh_context', {
  title: 'Read current QuillMesh context',
  description: 'Read the active QuillMesh document, current cursor, selected text, editor mode, dirty state, and disk revision.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    const context = await bridgeCall('/v1/context')
    return { structuredContent: context, content: [{ type: 'text', text: context?.active ? `Active QuillMesh document: ${context.path ?? context.displayName}. Selection: ${context.selection?.selectedText || '(empty)'}.` : 'QuillMesh has no active document.' }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('diagnose_markdown', {
  title: 'Diagnose Markdown document',
  description: 'Check formulas and equation tags, Markdown tables, block quotes, image paths, and image alternative text.',
  inputSchema: { path: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path }) => {
  try {
    const document = await readMarkdown(path)
    const result = markdownDiagnostics(document.path, document.content)
    const errors = result.diagnostics.filter((item) => item.severity === 'error').length
    return { structuredContent: { path: document.path, revision: document.revision, ...result }, content: [{ type: 'text', text: `Checked formulas, numbering, tables, quotes, and images: ${errors} error(s), ${result.diagnostics.length - errors} other finding(s).` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('propose_markdown_patch', {
  title: 'Propose a reviewed Markdown patch',
  description: 'Show a before/after Diff inside QuillMesh, wait for accept or reject, then apply the exact patch with SHA-256 conflict protection and refresh QuillMesh.',
  inputSchema: { path: z.string().min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/i), search: z.string().min(1), replacement: z.string(), occurrence: z.number().int().min(1).default(1), title: z.string().max(120).optional() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ path, expectedRevision, search, replacement, occurrence, title }) => {
  try {
    const document = await readMarkdown(path)
    if (document.revision !== expectedRevision.toLowerCase()) return { isError: true, structuredContent: { conflict: true, expectedRevision, actualRevision: document.revision }, content: [{ type: 'text', text: 'Revision conflict before review; no proposal was shown.' }] }
    const review = await bridgeCall('/v1/proposals', { path: document.path, expectedRevision, search, replacement, occurrence, title: title || 'Codex 修改建议' }, 10 * 60_000)
    if (review?.decision !== 'accepted') return { structuredContent: { applied: false, decision: 'rejected', path: document.path }, content: [{ type: 'text', text: 'The change was rejected in QuillMesh; nothing was written.' }] }
    const result = await applyPatch(document.path, expectedRevision, search, replacement, occurrence)
    if (result.conflict) return { isError: true, structuredContent: result, content: [{ type: 'text', text: 'The file changed after approval; revision protection prevented the write.' }] }
    await bridgeCall('/v1/refresh', { path: document.path }).catch(() => undefined)
    return { structuredContent: { applied: true, review, ...result }, content: [{ type: 'text', text: `Approved and applied the patch to ${basename(document.path)}.` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('propose_markdown_edits', {
  title: 'Propose reviewed paragraph edits',
  description: 'Show multiple paragraph-level before/after Diffs inside QuillMesh, then apply them atomically only after acceptance and a final revision check.',
  inputSchema: {
    path: z.string().min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/i), title: z.string().max(120).optional(),
    edits: z.array(z.object({ search: z.string().min(1), replacement: z.string(), occurrence: z.number().int().min(1).default(1) })).min(1).max(50),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ path, expectedRevision, title, edits }) => {
  try {
    const document = await readMarkdown(path)
    if (document.revision !== expectedRevision.toLowerCase()) return { isError: true, structuredContent: { conflict: true, expectedRevision, actualRevision: document.revision }, content: [{ type: 'text', text: 'Revision conflict before review; no proposal was shown.' }] }
    const review = await bridgeCall('/v1/proposals', { path: document.path, expectedRevision, edits, title: title || 'Codex 逐段修改建议' }, 10 * 60_000)
    if (review?.decision !== 'accepted') return { structuredContent: { applied: false, decision: 'rejected', path: document.path }, content: [{ type: 'text', text: 'The paragraph edits were rejected in QuillMesh; nothing was written.' }] }
    const result = await applyPatches(document.path, expectedRevision, edits)
    if (result.conflict) return { isError: true, structuredContent: result, content: [{ type: 'text', text: 'The file changed after approval; revision protection prevented every edit.' }] }
    await bridgeCall('/v1/refresh', { path: document.path }).catch(() => undefined)
    return { structuredContent: { applied: true, review, ...result }, content: [{ type: 'text', text: `Approved and atomically applied ${edits.length} paragraph edit(s).` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('repair_formula_layout', {
  title: 'Review safe formula layout repairs',
  description: 'Normalize standalone inline formulas and compact block formulas, show the complete Diff in QuillMesh, and write only after approval with revision protection.',
  inputSchema: { path: z.string().min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/i) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ path, expectedRevision }) => {
  try {
    const document = await readMarkdown(path)
    if (document.revision !== expectedRevision.toLowerCase()) return { isError: true, structuredContent: { conflict: true, actualRevision: document.revision }, content: [{ type: 'text', text: 'Revision conflict; inspect the document again.' }] }
    const repair = safelyNormalizeFormulas(document.content)
    if (!repair.changes.length) return { structuredContent: { applied: false, changes: [] }, content: [{ type: 'text', text: 'No safe formula-layout repairs were needed.' }] }
    const review = await bridgeCall('/v1/proposals', { path: document.path, expectedRevision, search: document.content, replacement: repair.content, occurrence: 1, title: '公式排版自动修复' }, 10 * 60_000)
    if (review?.decision !== 'accepted') return { structuredContent: { applied: false, decision: 'rejected', changes: repair.changes }, content: [{ type: 'text', text: 'Formula repairs were rejected; nothing was written.' }] }
    const result = await applyPatch(document.path, expectedRevision, document.content, repair.content, 1)
    if (result.conflict) return { isError: true, structuredContent: result, content: [{ type: 'text', text: 'The file changed after approval; no repairs were written.' }] }
    await bridgeCall('/v1/refresh', { path: document.path }).catch(() => undefined)
    return { structuredContent: { applied: true, changes: repair.changes, ...result }, content: [{ type: 'text', text: `Applied ${repair.changes.length} approved formula-layout repair(s).` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('export_document', {
  title: 'Export from QuillMesh',
  description: 'Export the active QuillMesh document to PDF, PNG, HTML, or Word DOCX at an explicit absolute target path.',
  inputSchema: { format: z.enum(['pdf', 'png', 'html', 'docx']), targetPath: z.string().min(1), path: z.string().min(1).optional(), overwrite: z.boolean().default(false) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ format, targetPath, path, overwrite }) => {
  try {
    if (!isAbsolute(targetPath)) throw new Error('targetPath must be absolute.')
    const result = await bridgeCall('/v1/export', { format, targetPath, overwrite, ...(path ? { path: resolve(path) } : {}) }, 120_000)
    return { structuredContent: result, content: [{ type: 'text', text: `Exported ${format.toUpperCase()} to ${result.path}.` }] }
  } catch (error) { return toolError(error) }
})

server.registerTool('apply_markdown_patch', {
  title: 'Apply revision-safe Markdown patch',
  description: 'Replace one exact text occurrence in a Markdown file only when its SHA-256 revision still matches the inspected revision.',
  inputSchema: { path: z.string().min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/i), search: z.string().min(1), replacement: z.string(), occurrence: z.number().int().min(1).default(1) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ path, expectedRevision, search, replacement, occurrence }) => {
  try {
    const result = await applyPatch(path, expectedRevision, search, replacement, occurrence)
    if (result.conflict) return { isError: true, structuredContent: result, content: [{ type: 'text', text: 'Revision conflict: the file changed after it was inspected. No changes were applied.' }] }
    await bridgeCall('/v1/refresh', { path: result.path }).catch(() => undefined)
    return { structuredContent: result, content: [{ type: 'text', text: `Applied the Markdown patch to ${basename(result.path)}. New revision: ${result.revision}.` }] }
  } catch (error) { return toolError(error) }
})

function quillMeshExecutable(): string {
  if (process.env.QUILLMESH_EXECUTABLE) return process.env.QUILLMESH_EXECUTABLE
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'QuillMesh', 'QuillMesh.exe')
  if (process.platform === 'darwin') return '/Applications/QuillMesh.app/Contents/MacOS/QuillMesh'
  return 'quillmesh'
}

server.registerTool('open_in_quillmesh', {
  title: 'Open document in QuillMesh',
  description: 'Open a local Markdown file in QuillMesh and optionally locate an exact heading or approximate line.',
  inputSchema: { path: z.string().min(1), heading: z.string().min(1).optional(), line: z.number().int().min(1).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path, heading, line }) => {
  try {
    const document = await readMarkdown(path)
    try {
      const result = await bridgeCall('/v1/open', { path: document.path, heading, line })
      return { structuredContent: { ...result, heading, line }, content: [{ type: 'text', text: `Opened ${basename(document.path)} in QuillMesh${heading ? ` at “${heading}”` : line ? ` near line ${line}` : ''}.` }] }
    } catch {}
    const executable = quillMeshExecutable()
    if (process.platform !== 'linux' && !existsSync(executable)) throw new Error(`QuillMesh executable was not found at ${executable}. Set QUILLMESH_EXECUTABLE to override it.`)
    const child = spawn(executable, [document.path], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    if (await waitForBridge()) await bridgeCall('/v1/open', { path: document.path, heading, line }).catch(() => undefined)
    return { structuredContent: { opened: true, path: document.path, executable, heading, line }, content: [{ type: 'text', text: `Opened ${basename(document.path)} in QuillMesh${heading ? ` at “${heading}”` : line ? ` near line ${line}` : ''}.` }] }
  } catch (error) { return toolError(error) }
})

async function heartbeat(): Promise<void> {
  await bridgeCall('/v1/companion-status', { version: COMPANION_VERSION }, 1_500).catch(() => undefined)
}

const heartbeatTimer = setInterval(() => { void heartbeat() }, 5_000)
heartbeatTimer.unref()
void heartbeat()
await server.connect(new StdioServerTransport())

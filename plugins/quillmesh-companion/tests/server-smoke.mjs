import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = process.env.QUILLMESH_PLUGIN_STAGE || root
const fixture = join(root, 'tests/fixtures/sample.md')
const client = new Client({ name: 'quillmesh-companion-smoke', version: '0.2.2' })
const transport = new StdioClientTransport({ command: process.execPath, args: [join(runtimeRoot, 'dist/server.mjs')], cwd: runtimeRoot })
await client.connect(transport)

const tools = await client.listTools()
for (const required of ['inspect_markdown', 'read_markdown', 'validate_formulas', 'diagnose_markdown', 'get_quillmesh_context', 'propose_markdown_patch', 'propose_markdown_edits', 'repair_formula_layout', 'export_document', 'apply_markdown_patch', 'open_in_quillmesh']) {
  if (!tools.tools.some((tool) => tool.name === required)) throw new Error(`Missing tool: ${required}`)
}
for (const removed of ['render_formula', 'render_document', 'render_document_asset']) {
  if (tools.tools.some((tool) => tool.name === removed)) throw new Error(`Conversation preview tool should not be exposed: ${removed}`)
}

const inspected = await client.callTool({ name: 'inspect_markdown', arguments: { path: fixture } })
if (inspected.isError || inspected.structuredContent?.formulas?.length !== 2) throw new Error('Document inspection failed.')

const validated = await client.callTool({ name: 'validate_formulas', arguments: { path: fixture } })
if (validated.isError || validated.structuredContent?.invalidCount !== 0) throw new Error('Formula validation failed.')

const diagnosed = await client.callTool({ name: 'diagnose_markdown', arguments: { path: fixture } })
if (diagnosed.isError || diagnosed.structuredContent?.diagnostics?.some((item) => item.rule === 'image-path')) throw new Error('Markdown diagnostics incorrectly reported the existing fixture image as missing.')

const diagnosticsDirectory = await mkdtemp(join(tmpdir(), 'quillmesh-companion-diagnostics-'))
try {
  const missingImageFixture = join(diagnosticsDirectory, 'missing-image.md')
  await writeFile(missingImageFixture, '# Missing image\n\n![Example](assets/missing.png)\n', 'utf8')
  const missingImageDiagnosis = await client.callTool({ name: 'diagnose_markdown', arguments: { path: missingImageFixture } })
  if (missingImageDiagnosis.isError || !missingImageDiagnosis.structuredContent?.diagnostics?.some((item) => item.rule === 'image-path')) throw new Error('Markdown diagnostics failed to report a missing image.')
} finally {
  await rm(diagnosticsDirectory, { recursive: true, force: true })
}

const original = await readFile(fixture, 'utf8')
const revision = createHash('sha256').update(original).digest('hex')
const conflict = await client.callTool({ name: 'apply_markdown_patch', arguments: { path: fixture, expectedRevision: '0'.repeat(64), search: 'Formula sample', replacement: 'Changed' } })
if (!conflict.isError || conflict.structuredContent?.actualRevision !== revision) throw new Error('Revision conflict guard failed.')

const editDirectory = await mkdtemp(join(tmpdir(), 'quillmesh-companion-test-'))
try {
  const editable = join(editDirectory, 'editable.md')
  await copyFile(fixture, editable)
  const patched = await client.callTool({ name: 'apply_markdown_patch', arguments: { path: editable, expectedRevision: revision, search: 'Formula sample', replacement: 'Updated formula sample' } })
  const updated = await readFile(editable, 'utf8')
  if (patched.isError || !updated.includes('# Updated formula sample')) throw new Error('Revision-safe patch failed.')
} finally {
  await rm(editDirectory, { recursive: true, force: true })
}

await client.close()
console.log('QuillMesh Companion smoke test passed.')

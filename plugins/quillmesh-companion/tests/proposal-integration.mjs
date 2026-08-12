import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const folder = await mkdtemp(join(tmpdir(), 'quillmesh-proposal-'))
const target = join(folder, 'codex-diff-review.md')
const resultPath = process.env.QUILLMESH_PROPOSAL_RESULT || join(root, 'tests/artifacts/proposal-result.json')
await copyFile(join(root, 'tests/fixtures/sample.md'), target)
const client = new Client({ name: 'quillmesh-proposal-integration', version: '0.2.0' })
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/server.mjs')], cwd: root })
await client.connect(transport)
try {
  await client.callTool({ name: 'open_in_quillmesh', arguments: { path: target, heading: 'Formula sample' } })
  const inspected = await client.callTool({ name: 'inspect_markdown', arguments: { path: target } })
  const proposed = await client.callTool({ name: 'propose_markdown_patch', arguments: {
    path: target, expectedRevision: inspected.structuredContent.revision,
    search: '# Formula sample', replacement: '# Formula preview approved', title: 'Diff 接受/拒绝联调',
  } })
  const content = await readFile(target, 'utf8')
  await writeFile(resultPath, JSON.stringify({ proposed: proposed.structuredContent, isError: proposed.isError, changed: content.includes('# Formula preview approved') }, null, 2))
} finally {
  await client.close()
  await rm(folder, { recursive: true, force: true })
}

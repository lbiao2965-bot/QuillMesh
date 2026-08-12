import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'node:path'

const root = process.cwd()
const fixture = join(root, 'tests/fixtures/sample.md')
const client = new Client({ name: 'quillmesh-bridge-integration', version: '0.2.2' })
const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/server.mjs')], cwd: root })
await client.connect(transport)
try {
  const opened = await client.callTool({ name: 'open_in_quillmesh', arguments: { path: fixture, heading: 'Formula sample' } })
  if (opened.isError || !opened.structuredContent?.opened) throw new Error('Open and locate failed.')
  const context = await client.callTool({ name: 'get_quillmesh_context', arguments: {} })
  if (context.isError || context.structuredContent?.path?.toLowerCase() !== fixture.toLowerCase()) throw new Error('Live context failed.')
  const tools = await client.listTools()
  if (tools.tools.some((tool) => ['render_formula', 'render_document', 'render_document_asset'].includes(tool.name))) throw new Error('Conversation preview tools are still exposed.')
  console.log(JSON.stringify({ opened: opened.structuredContent, context: context.structuredContent }, null, 2))
} finally {
  await client.close()
}

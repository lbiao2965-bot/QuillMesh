import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'

export interface CodexBridgeHandlers {
  context: () => Promise<unknown>
  companionStatus: (payload: Record<string, unknown>) => Promise<unknown>
  open: (payload: Record<string, unknown>) => Promise<unknown>
  propose: (payload: Record<string, unknown>) => Promise<unknown>
  refresh: (payload: Record<string, unknown>) => Promise<unknown>
  exportDocument: (payload: Record<string, unknown>) => Promise<unknown>
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.from(chunk)
    size += data.length
    if (size > 12 * 1024 * 1024) throw new Error('Request body is too large.')
    chunks.push(data)
  }
  if (!chunks.length) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required.')
  return value as Record<string, unknown>
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  const data = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' })
  response.end(data)
}

export async function startCodexBridge(statePath: string, handlers: CodexBridgeHandlers): Promise<() => Promise<void>> {
  const token = randomBytes(32).toString('hex')
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { reply(response, 401, { ok: false, error: 'Unauthorized.' }); return }
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      let result: unknown
      if (method === 'GET' && url.pathname === '/v1/context') result = await handlers.context()
      else if (method === 'POST' && url.pathname === '/v1/companion-status') result = await handlers.companionStatus(await bodyOf(request))
      else if (method === 'POST' && url.pathname === '/v1/open') result = await handlers.open(await bodyOf(request))
      else if (method === 'POST' && url.pathname === '/v1/proposals') result = await handlers.propose(await bodyOf(request))
      else if (method === 'POST' && url.pathname === '/v1/refresh') result = await handlers.refresh(await bodyOf(request))
      else if (method === 'POST' && url.pathname === '/v1/export') result = await handlers.exportDocument(await bodyOf(request))
      else { reply(response, 404, { ok: false, error: 'Unknown endpoint.' }); return }
      reply(response, 200, { ok: true, result })
    } catch (error) {
      reply(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start the Codex bridge.')
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({ version: 1, port: address.port, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    await unlink(statePath).catch(() => {})
  }
}

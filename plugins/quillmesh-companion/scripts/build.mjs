import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(root, 'dist'), { recursive: true })

await build({
  entryPoints: [join(root, 'src/server.ts')],
  outfile: join(root, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
console.log('Built QuillMesh Companion MCP server.')

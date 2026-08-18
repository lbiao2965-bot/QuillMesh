# Third-party software

QuillMesh includes open-source dependencies installed from npm. The authoritative dependency graph and exact resolved versions are recorded in `package-lock.json` and `plugins/quillmesh-companion/package-lock.json`.

Direct application dependencies include:

| Package         | License |
| --------------- | ------- |
| `@milkdown/kit` | MIT     |
| `docx`          | MIT     |
| `katex`         | MIT     |
| `mermaid`       | MIT     |
| `remark-breaks` | MIT     |
| `remark-math`   | MIT     |

Direct Companion dependencies include:

| Package                     | License |
| --------------------------- | ------- |
| `@modelcontextprotocol/sdk` | MIT     |
| `katex`                     | MIT     |
| `zod`                       | MIT     |

Build tooling includes MIT-licensed Electron, electron-builder, electron-vite, Vite, and esbuild, plus Apache-2.0-licensed TypeScript. Each dependency remains subject to its own copyright notice and license terms; packaged dependency license files should be distributed with binary releases.

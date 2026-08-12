# QuillMesh

**A local-first Markdown editor for people and AI agents.**

**English** · [简体中文](README_CN.md)

QuillMesh combines a Typora-inspired WYSIWYG writing experience with file coordination designed for Codex, Claude Code, scripts, and other external tools. It reads and writes ordinary `.md` files, uses no proprietary document format, and does not require cloud storage.

> Current version: `0.2.1`. QuillMesh is an early-stage project; feedback and contributions are welcome.

<p align="center">
  <img src="assets/主页.png" alt="QuillMesh home screen" width="900">
</p>

## Why QuillMesh

People and agents increasingly edit the same Markdown files. You may be reorganizing a document while an agent adds content and a script updates data. Traditional editors can silently reload, overwrite newer content, or leave the user to determine which copy is authoritative.

QuillMesh treats the file as a shared handoff surface:

- Clean documents refresh automatically after external writes.
- Overlapping local and external changes open a conflict dialog instead of occupying the editor permanently.
- Saves validate the disk revision before writing.
- Closing a tab or window checks all unsaved documents.
- Companion changes appear as a Diff in QuillMesh and are written only after acceptance.

## Highlights

### Writing and navigation

- WYSIWYG, source, and synchronized source/preview split views.
- Multi-tab editing, recent documents, and sibling Markdown browsing.
- Outline navigation, heading folding, and drag-to-reorder sections.
- Bold, italic, links, quotes, ordered/unordered/task lists, highlights, and inline code.
- `Ctrl+Shift+P` command palette, `/` insert menu, and a Typora-inspired context menu.
- Consolidated task view with incomplete-task filtering and source navigation.

<p align="center">
  <img src="assets/文件编辑.png" alt="QuillMesh editor, outline, and Codex status" width="1000">
</p>

### Tables, code, and insertion

- GFM table editing, whole-table alignment, row/column actions, and draggable column widths.
- Code-block copy, language selection, and wrapping.
- Insert images, tables, code blocks, formulas, horizontal rules, and paragraphs above or below.
- Link hover previews with open and copy actions.

<p align="center">
  <img src="assets/插入.png" alt="QuillMesh insert menu" width="760">
</p>

### Math

- LaTeX inline and centered block math.
- Live formula preview while editing.
- Optional automatic numbering for block equations.
- Companion checks for formula syntax, layout, and numbering.

<p align="center">
  <img src="assets/公式编辑.png" alt="QuillMesh LaTeX editor with live preview" width="760">
</p>

### Images and assets

- Clipboard images are stored beside the document under `assets/` and inserted with relative paths.
- Drag handles resize images while preserving the intended Markdown display size.
- Context actions copy an image or path and reveal the asset in the file manager.
- Click-to-open lightbox with wheel zoom and drag-to-pan.

<p align="center">
  <img src="assets/图片编辑.png" alt="QuillMesh image resizing and task view" width="760">
</p>

### File safety and export

- External-change watching, revision conflicts, and an autosave toggle.
- Guarded rendering for very long documents.
- PDF, PNG, HTML, and Word `.docx` export.
- English/Chinese UI, custom CSS themes, and cross-platform build targets.

## Codex collaboration

The repository includes [QuillMesh Companion](plugins/quillmesh-companion/README.md). Once installed and enabled, Codex can directly read the active QuillMesh document, cursor, and selection over local MCP. You do not need to paste the Markdown body into the conversation.

Typical workflow:

1. Open QuillMesh and the Markdown document you want to work on.
2. Ask Codex to “read the current QuillMesh document,” “check the current section's formulas,” or “rewrite my selection.”
3. Companion obtains only the required context and retains the current revision.
4. Proposed changes appear as paragraph-level Diffs at the original location in QuillMesh.
5. Accept or reject the proposal; accepted changes pass another revision check before writing and refreshing.

The upper-right Codex menu and `Ctrl+Shift+P` palette provide shortcuts for selection, current-section, and full-document requests. They can generate an operation prompt, but Companion reads the document itself—no manual content paste is required. The status bar shows whether Codex is connected.

Companion can also:

- inspect Markdown structure, formulas, tables, quotes, and image paths;
- read bounded line ranges instead of flooding context with long documents;
- open a file at a heading or approximate line;
- apply exact revision-safe replacements or atomic multi-paragraph edits;
- export PDF, PNG, HTML, or DOCX when explicitly requested.

The bridge listens only on `127.0.0.1` and uses a random bearer token. QuillMesh does not upload documents to a separate hosted bridge.

## Quick start

### Installers

Packaged installers are not committed to the repository. Download them from [GitHub Releases](https://github.com/lbiao2965-bot/QuillMesh/releases) after a release is published, or build one locally with the commands below.

### Run from source

Node.js 22.12 or newer is required.

```powershell
cd QuillMesh
npm install
npm run dev
```

Build the application:

```powershell
npm run build
```

Create an installer:

```powershell
npm run dist:win
```

Artifacts are written to `release/` by default.

## Useful shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Open file | `Ctrl+O` | `⌘O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` | `⌘S` / `⌘⇧S` |
| Close tab | `Ctrl+W` | `⌘W` |
| Command palette | `Ctrl+Shift+P` | `⌘⇧P` |
| Search | `Ctrl+F` | `⌘F` |
| Bold / italic | `Ctrl+B` / `Ctrl+I` | `⌘B` / `⌘I` |
| Link | `Ctrl+K` | `⌘K` |
| Headings 1–6 | `Ctrl+1`–`Ctrl+6` | `⌘1`–`⌘6` |
| Source mode | `Ctrl+/` | `⌘/` |
| Insert/edit math | `Ctrl+Shift+E` | `⌘⇧E` |
| Insert image | `Ctrl+Shift+I` | `⌘⇧I` |
| Insert code block | `Ctrl+Shift+K` | `⌘⇧K` |

## Project layout

```text
src/main/       Electron main process, sessions, conflict safety, export, and local bridge
src/preload/    Typed IPC boundary
src/renderer/   Milkdown/ProseMirror editor and application UI
src/shared/     Shared types and translations
resources/      Icons, demos, and built-in templates
themes/         Example CSS themes
plugins/        QuillMesh Companion Codex plugin and MCP server
assets/         README product screenshots
```

See the [architecture guide](docs/ARCHITECTURE.md) for implementation details.

## Development and verification

Before submitting a change, install both dependency sets and run the unified verification command:

```powershell
npm install
npm --prefix plugins/quillmesh-companion install
npm run verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [SECURITY.md](SECURITY.md) for responsible vulnerability reporting, and [docs/SIGNING.md](docs/SIGNING.md) for signed release requirements.

## Roadmap

- Continue improving compatibility with CommonMark/GFM and common Typora conventions.
- Extend long-document performance and cross-directory asset management.
- Polish Companion installation, Diff review, and additional agent workflows.
- Publish downloadable Windows, macOS, and Linux builds.

## License and attribution

QuillMesh is distributed under the [MIT License](LICENSE).

QuillMesh is derived from [ColaMD](https://github.com/marswaveai/ColaMD). Copyright in the original work remains with `marswave.ai`; QuillMesh contributors retain rights in their respective additions and modifications. Keep the original copyright and permission notice in [LICENSE](LICENSE) and [NOTICE](NOTICE).

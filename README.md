# QuillMesh

**A local-first Markdown editor for people and AI.**

**English** · [简体中文](README_CN.md)

[![Release](https://img.shields.io/github/v/release/lbiao2965-bot/QuillMesh?include_prereleases&label=preview)](https://github.com/lbiao2965-bot/QuillMesh/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#download)

<p align="center">
  <img src="assets/quillmesh-x-launch-v1.png" alt="QuillMesh — local-first Markdown editor for people and AI" width="1200">
</p>

QuillMesh is a calm, Typora-inspired desktop editor for ordinary Markdown files. It brings writing, navigation, review comments, LaTeX, tables, images, export, and revision-safe AI collaboration into one workspace—without introducing a proprietary document format or requiring cloud storage.

> Current development version: `0.2.6`. QuillMesh is an early preview; compatibility and interaction details will continue to improve.

## Start with your files

Open an existing Markdown file, create a new one, or return to a recent document from the home screen. QuillMesh reads and writes `.md` directly, so the same files remain available to Git, scripts, Codex, and any other Markdown tool.

<p align="center">
  <img src="assets/主页.png" alt="QuillMesh home screen with open, new, and recent files" width="900">
</p>

## What QuillMesh brings together

### Writing and navigation

- WYSIWYG, source, and synchronized source/preview split modes.
- Browser-like tabs, recent files, and sibling Markdown browsing.
- Outline navigation, heading folding, and drag-to-reorder sections.
- Bold, italic, links, quotes, ordered, unordered and task lists, highlight, and inline code.
- `Ctrl+Shift+P` command palette, `/` quick insert, and context-aware menus.
- Consolidated task view with incomplete-task filtering and jump-to-source behavior.
- Full-screen toolbar with `Esc` and `F11` exit support.

<p align="center">
  <img src="assets/文件编辑.png" alt="QuillMesh document editing, outline, and navigation" width="1100">
</p>

### Review without changing the Markdown

Select text and add a comment from the context menu, then manage the discussion in the Review panel. Comments live in a document-side `.quillmesh/<filename>.annotations.json` file, keeping the Markdown body clean and portable.

- Highlight comment anchors directly in the rendered document.
- Filter open, resolved, or all comments.
- Resolve, reopen, or delete comments without touching the Markdown source.
- Keep Codex suggestions in the same review surface with explicit Accept and Reject actions.
- Re-locate annotations from their text and surrounding context after nearby edits.

<p align="center">
  <img src="assets/批注.png" alt="QuillMesh review mode and comment sidebar" width="1100">
</p>

### Visual LaTeX editing

- Inline math and centered display math rendered by KaTeX.
- Live preview while editing LaTeX.
- Visual palettes for common symbols, Greek letters, set and logic notation, and calculus operators.
- Reusable templates for fractions, roots, matrices, piecewise functions, and equation systems.
- LaTeX command autocomplete, selection-aware insertion, favorites, and recent-formula history.
- Optional automatic numbering for block equations.
- Formula-aware HTML, PDF, PNG, and DOCX export.

<p align="center">
  <img src="assets/公式编辑.png" alt="QuillMesh visual LaTeX input assistant and live preview" width="1100">
</p>

### Tables, code, links, and quick insertion

- GFM table editing, whole-table alignment, contextual row and column actions, copy/delete, and draggable column widths.
- Code-block copy, language selection, and optional line wrapping.
- Insert images, tables, code blocks, formulas, horizontal rules, or paragraphs above and below.
- Link hover previews with open and copy actions.

<p align="center">
  <img src="assets/插入.png" alt="QuillMesh formatting and insert menus" width="1000">
</p>

### Images and local assets

- Paste clipboard images into a document-local `assets/` folder.
- Keep portable relative paths in Markdown.
- Resize images visually with drag handles.
- Copy an image, reset its size, or reveal it in the file manager from the context menu.
- Open a lightbox preview, zoom with the mouse wheel, and drag to pan.

<p align="center">
  <img src="assets/图片编辑.png" alt="QuillMesh image resizing and image actions" width="1000">
</p>

## Local-first and conflict-aware

Markdown is increasingly shared by people, scripts, and AI agents. A document may be open locally while Codex updates a section or another tool refreshes generated content. QuillMesh treats the file as a shared handoff surface instead of silently choosing which version wins:

- clean documents refresh automatically after external writes;
- overlapping local and external edits open a focused comparison dialog;
- saves verify the on-disk revision before replacing content;
- closing a tab or window checks every unsaved document;
- AI proposals remain visible as reviewed Diffs until accepted or rejected.

## Optional Codex collaboration

Codex integration is disabled by default and can be enabled in Settings. The repository includes [QuillMesh Companion](plugins/quillmesh-companion/README.md), a local Codex plugin and MCP service that can:

- read the active document, cursor, selection, or current section;
- inspect Markdown structure, formulas, tables, tasks, and image paths;
- open a document and locate a heading or approximate line;
- propose revision-bound exact or multi-paragraph edits;
- return changes to QuillMesh as a visible Diff and review suggestion;
- request PDF, PNG, HTML, or DOCX export.

A reviewed workflow stays explicit:

1. Select text or place the cursor in a section in QuillMesh.
2. Send the selection, section, or full document to Codex.
3. Codex prepares a proposal against the current document revision.
4. QuillMesh shows the Diff and records it in Review.
5. Accept or reject it; accepted changes pass another revision check before writing.

The bridge listens only on `127.0.0.1` and uses a random bearer token. QuillMesh does not upload documents to a separate hosted bridge.

## Personal settings

Open Settings from the home screen, **File → Settings**, or `Ctrl+,`.

- Elegant, Light, Dark, Newsprint, or imported CSS themes.
- Theme, sans-serif, serif, or monospace editor fonts.
- Font size, line spacing, and content width.
- Autosave and status-bar controls.
- Windows Markdown default-app status and a direct link to system confirmation.
- Optional Codex integration.

Preferences are stored locally and restored on the next launch.

## Export

QuillMesh exports the active document to PDF, PNG image, self-contained HTML, and Microsoft Word `.docx`.

## Download

Download preview installers from [GitHub Releases](https://github.com/lbiao2965-bot/QuillMesh/releases):

- Windows installer (`.exe`)
- macOS package (`.dmg` / `.zip`, currently Apple silicon in the automated preview build)
- Linux AppImage and Debian package (`.deb`)

Preview packages may be unsigned and can trigger an operating-system security warning.

The Windows installer registers QuillMesh as an available handler for `.md`, `.markdown`, `.mdown`, and `.mkd`. Windows keeps the final default-app choice under user control. After installation, open **Settings → Files → Manage default apps**, then choose QuillMesh for the Markdown extensions you use.

## Build from source

Requirements: Node.js 22.12 or newer and npm.

```powershell
git clone https://github.com/lbiao2965-bot/QuillMesh.git
cd QuillMesh
npm install
npm run dev
```

Verify and package:

```powershell
npm run verify
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Artifacts are written to `release/` by default.

## Useful shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Open file | `Ctrl+O` | `⌘O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` | `⌘S` / `⌘⇧S` |
| Close tab | `Ctrl+W` | `⌘W` |
| Settings | `Ctrl+,` | `⌘,` |
| Command palette | `Ctrl+Shift+P` | `⌘⇧P` |
| Search | `Ctrl+F` | `⌘F` |
| Bold / italic | `Ctrl+B` / `Ctrl+I` | `⌘B` / `⌘I` |
| Link | `Ctrl+K` | `⌘K` |
| Headings 1–6 | `Ctrl+1`–`Ctrl+6` | `⌘1`–`⌘6` |
| Source mode | `Ctrl+/` | `⌘/` |
| Insert/edit formula | `Ctrl+Shift+E` | `⌘⇧E` |
| Insert image | `Ctrl+Shift+I` | `⌘⇧I` |
| Insert code block | `Ctrl+Shift+K` | `⌘⇧K` |
| Toggle full screen | `F11` | `⌃⌘F` |
| Exit full screen | `Esc` | `Esc` |

Review mode and Add comment are also available from the command palette and the editor context menu.

## Project structure

```text
src/main/       Electron main process, document sessions, annotations, export, and local bridge
src/preload/    Typed IPC boundary
src/renderer/   Milkdown/ProseMirror editor, review tools, and desktop UI
src/shared/     Shared settings, types, and translations
resources/      Icons, demos, and built-in templates
themes/         Example CSS themes
plugins/        QuillMesh Companion plugin and MCP service
assets/         Product artwork and screenshots used by this README
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details, [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [SECURITY.md](SECURITY.md) for responsible vulnerability reporting, and [docs/SIGNING.md](docs/SIGNING.md) for release-signing requirements.

## Roadmap

- Improve CommonMark/GFM and common Typora compatibility.
- Continue long-document performance work.
- Expand review anchors, asset management, and export fidelity.
- Polish Companion installation and reviewed agent workflows.
- Publish signed Windows and notarized macOS builds.

## License and attribution

QuillMesh is distributed under the [MIT License](LICENSE).

QuillMesh is derived from [ColaMD](https://github.com/marswaveai/ColaMD). Copyright in the original work remains with `marswave.ai`; QuillMesh contributors retain rights in their respective additions and modifications. Keep the original copyright and permission notice in [LICENSE](LICENSE) and [NOTICE](NOTICE).

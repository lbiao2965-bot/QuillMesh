# QuillMesh architecture

QuillMesh is an Electron application built with TypeScript, Vite, Milkdown/ProseMirror, KaTeX, and `docx`.

## Process boundaries

- `src/main/` owns filesystem access, document sessions, watchers, conflict-aware saves, managed assets, and native export.
- `src/preload/` exposes a narrow typed IPC surface.
- `src/renderer/` owns editor state, tabs, panels, commands, themes, and presentation controls.

Each open file has a main-process document session with a UUID, canonical path, disk revision, edit version, and watcher. Saves include the revision observed by the editor. A changed target is rejected as a conflict unless the user explicitly authorizes a force-save for that exact target.

Milkdown/ProseMirror provides WYSIWYG editing. Presentation-only state such as heading folding and code wrapping is not serialized into Markdown. Export operates on a sanitized clone and restores folded content before producing HTML, PDF, PNG, or DOCX.

Clipboard images are created only inside a managed directory beside the saved document. Canonical-path containment and exclusive file creation protect the resource boundary.

## Compatibility keys

Some internal CSS classes, DOM events, and local-storage keys intentionally retain a `colamd-*` prefix. They form a compatibility layer for settings and custom themes created before the QuillMesh rename; they are not user-facing branding.

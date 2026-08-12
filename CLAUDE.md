# QuillMesh contributor guide

QuillMesh is a local-first Markdown editor for people and AI agents. Preserve ordinary Markdown files as the source of truth and keep external-edit safety ahead of cosmetic convenience.

## Development rules

* Keep filesystem ownership in the Electron main process.

* Expose only typed, document-scoped operations through preload.

* Do not reintroduce a window-global current-file path.

* Keep presentation state out of serialized Markdown.

* Preserve user data when switching tabs, closing windows, or handling external writes.

* Maintain the original ColaMD attribution in `LICENSE` and `NOTICE`.

* Internal `colamd-*` compatibility identifiers may remain until a migration strategy exists.

## Verification

Run all TypeScript checks, `node scripts/document-session-regression.cjs`, `npm run build`, and `git diff --check` before shipping.

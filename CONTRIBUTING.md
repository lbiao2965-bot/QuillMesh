# Contributing to QuillMesh

Thank you for improving QuillMesh. The project accepts focused bug fixes, compatibility improvements, accessibility work, documentation, and well-scoped editor or Companion features.

## Before opening a change

1. Search existing issues and keep one pull request focused on one problem.
2. Do not include private Markdown documents, credentials, local bridge state, generated installers, or unsanitized screenshots.
3. For a behavior change, explain how ordinary Markdown remains portable and how external-edit conflicts are handled.
4. Preserve the ColaMD copyright and attribution in `LICENSE` and `NOTICE`.

## Development setup

Use Node.js 22.12 or newer.

```powershell
npm install
npm --prefix plugins/quillmesh-companion install
npm run dev
```

The Electron main process owns filesystem access. Renderer code should use the typed preload boundary and document-scoped identifiers; do not introduce a window-global current-file path. UI-only state such as folded headings must not be serialized into Markdown.

## Verification

Run the same command used by CI:

```powershell
npm run verify
git diff --check
```

Visible editor changes should also be exercised manually with a temporary Markdown file. Test unsaved closing, external changes, multiple tabs, and export when the affected code touches those paths.

## Commit and pull request guidance

- Use a concise imperative commit subject.
- Explain user-visible behavior, compatibility impact, and verification in the pull request.
- Add or update a deterministic regression test for data-loss, revision, parsing, or export defects.
- Keep generated `dist/` only where the Companion plugin intentionally tracks its runtime bundle; other application build outputs belong in Releases.

By contributing, you agree that your contribution is licensed under the repository's MIT License.

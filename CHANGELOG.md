# Changelog

Notable user-visible changes are documented here. The project follows semantic versioning after the first stable release; pre-1.0 releases may include compatibility changes.

## Unreleased

- Refined the home screen, tabs, contextual menus, image controls, and compact code-block toolbar.
- Added a unified Settings panel for theme, font, size, spacing, page width, autosave, and status-bar preferences.
- Made the Codex integration opt-in; its controls and local bridge remain disabled until explicitly enabled.
- Added an in-app full-screen toolbar plus `Esc` and `F11` exit behavior.
- Rebuilt application icons with clean transparency for desktop and packaged builds.
- Updated product screenshots and rewrote the English and Chinese project documentation.
- Improved settings persistence and added deterministic regression coverage for preference validation.

## 0.2.1 - 2026-08-12

* Renamed the desktop editor to QuillMesh with new application identity and artwork.
* Added multi-tab editing, recent documents, autosave control, source/preview split mode, outline reordering, heading folding, task view, and long-document rendering guards.
* Added external-change revision protection, reviewed Diff proposals, and close-with-unsaved-content handling.
* Added image asset paste, resize, copy, reveal, lightbox zoom, tables, code-block controls, link previews, command palette, and contextual insertion.
* Added formula editing and preview, optional block numbering, and PDF, PNG, HTML, and DOCX export.
* Added the local QuillMesh Companion integration for Codex.

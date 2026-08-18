# Changelog

Notable user-visible changes are documented here. The project follows semantic versioning after the first stable release; pre-1.0 releases may include compatibility changes.

## Unreleased

## 0.2.7 - 2026-08-18

- Added live Mermaid rendering for fenced `mermaid` code blocks, with source/preview switching, syntax feedback, full-screen viewing, editing, and SVG/PNG copy or save actions.
- Added BibTeX, BibLaTeX, and CSL JSON bibliography loading with automatic sibling-file discovery.
- Added searchable citation insertion, hover previews, missing-key warnings, author/numeric in-text display, and APA, MLA, Chicago, or GB/T 7714 reference formatting.
- Preserved Pandoc-compatible `[@citekey]` syntax when WYSIWYG content is serialized back to Markdown.
- Added a resizable references bar with jump, selection, copy, and insert-at-end workflows.
- Added reference-list output to PDF, PNG, HTML, and DOCX exports, and preserved rendered Mermaid diagrams in PDF, PNG, and HTML exports.
- Added a Mermaid and citation demonstration document plus deterministic parsing and syntax regression coverage.
- Rewrote the English and Chinese project documentation and added the latest citation-management screenshot.

## 0.2.6 - 2026-08-17

- Added a review mode with document-anchored comments, open/resolved filters, and highlighted comment ranges.
- Stored comments and review suggestions in per-document `.quillmesh` sidecar files so Markdown source remains unchanged.
- Integrated Codex proposals into the Review panel with explicit Accept and Reject states.
- Added context-aware annotation re-location after nearby text edits.
- Updated the English and Chinese documentation and replaced product screenshots with the latest interface.

## 0.2.5 - 2026-08-15

- Added a visual formula input assistant with common symbols, Greek letters, set and logic notation, calculus operators, and reusable templates.
- Added LaTeX command autocomplete, including shortcuts such as `\alp` to `\alpha`.
- Added formula favorites and a recent-formula history for quickly reusing expressions.
- Added rendered symbol previews and selection-aware template insertion inside the existing live formula editor.

## 0.2.4 - 2026-08-14

- Redesigned Settings with section navigation, visual theme cards, and refined sliders.
- Made the Settings panel draggable and translucent so appearance changes can be previewed against the document.
- Made the LaTeX formula editor draggable, added a compact close control, and kept the document visible while editing.
- Unified contextual menus and floating surfaces with smoother motion, spacing, and visual states.

## 0.2.3 - 2026-08-13

- Registered QuillMesh as a Windows handler for `.md`, `.markdown`, `.mdown`, and `.mkd` files.
- Added a Settings entry that reports the current Markdown association and opens QuillMesh directly in Windows Default Apps.
- Added single-instance launch routing so files opened from Explorer are handed to the running QuillMesh window.
- Changed the Windows installer to a per-machine installation so NSIS file associations are registered reliably.

## 0.2.2 - 2026-08-13

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

/* Deterministic safety regression for the documentId + revision contract. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

// Transpile actual source modules in memory. No generated test artifacts are
// left in the worktree.
function loadTypeScript(relativePath) {
  const sourcePath = require.resolve(relativePath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const sourceModule = new Module(sourcePath, module)
  sourceModule.filename = sourcePath
  sourceModule.paths = Module._nodeModulePaths(require('node:path').dirname(sourcePath))
  sourceModule._compile(output, sourcePath)
  return sourceModule.exports
}

const { DocumentRevisionGuard, canForceConflictedTarget, canonicalPotentialPath, canonicalPotentialPathKey, realPathIsWithin, revisionFor, saveDecision } = loadTypeScript('../src/main/document-session.ts')
const { sectionEndFromHeadings, sectionMoveInsertion } = loadTypeScript('../src/renderer/outline-reorder.ts')
const { authoritativeContent, mirrorWysiwygToSource } = loadTypeScript('../src/renderer/split-sync.ts')
const { remainsDirtyAfterSave } = loadTypeScript('../src/renderer/document-save.ts')
const { aggregateCloseCanComplete } = loadTypeScript('../src/renderer/close-save.ts')
const { conflictTargetToCancel, pendingConflictTarget, sameConflictTarget } = loadTypeScript('../src/renderer/conflict-routing.ts')
const { collapsedHeadingStep } = loadTypeScript('../src/renderer/heading-collapse.ts')
const { isEditorPresentationAttribute, isEditorPresentationClass } = loadTypeScript('../src/renderer/export-document.ts')
const { markdownSectionAtLine, sourceSelectionContext } = loadTypeScript('../src/renderer/codex-context.ts')
const { DEFAULT_APP_SETTINGS, mergeAppSettings, normalizeAppSettings } = loadTypeScript('../src/shared/settings.ts')

const cleanA = revisionFor('# A\n', 1000, 4)
const cleanB = revisionFor('# B\n', 1000, 4)
const changedA = revisionFor('# A external\n', 2000, 13)
const changedB = revisionFor('# B external\n', 2000, 13)
const guard = new DocumentRevisionGuard()

guard.register('doc-a', cleanA, true)
guard.register('doc-b', cleanB, false)

// A stale save is never permitted to overwrite a changed file.
assert.equal(guard.checkSave('doc-a', cleanA, changedA), 'conflict')

// Clean external updates are routed to their exact document only.
assert.equal(guard.externalChange('doc-b', changedB), 'clean-update')
assert.equal(guard.canAutosave('doc-a'), true)

// Dirty external updates preserve local edits and pause only that document.
assert.equal(guard.externalChange('doc-a', changedA), 'conflict')
assert.equal(guard.canAutosave('doc-a'), false)
assert.equal(guard.canAutosave('doc-b'), false)

// A deleted on-disk document is also a CAS conflict, never an implicit recreate.
const deleted = new DocumentRevisionGuard()
deleted.register('doc-deleted', cleanA, true)
assert.equal(deleted.externalDeletion('doc-deleted'), 'conflict')
assert.equal(deleted.checkSave('doc-deleted', cleanA, null), 'conflict')
assert.equal(deleted.canAutosave('doc-deleted'), false)

// Even if a watcher never reported the removal, save-time disk validation sees
// the missing revision and rejects an implicit recreate.
const missedWatcher = new DocumentRevisionGuard()
missedWatcher.register('doc-missed-watcher', cleanA, true)
assert.equal(missedWatcher.checkSave('doc-missed-watcher', cleanA, null), 'conflict')

// The main process calls this production helper immediately before its atomic
// rename; it covers stale revisions, Save As destinations, and watcher gaps.
assert.equal(saveDecision({ pathChanged: false, baseRevision: cleanA, sessionRevision: cleanA, deleted: false, diskRevision: changedA }), 'conflict')
assert.equal(saveDecision({ pathChanged: false, baseRevision: cleanA, sessionRevision: cleanA, deleted: false, diskRevision: null }), 'conflict')
assert.equal(saveDecision({ pathChanged: true, baseRevision: null, sessionRevision: null, deleted: false, diskRevision: null }), 'write')
assert.equal(saveDecision({ pathChanged: true, baseRevision: null, sessionRevision: null, deleted: false, diskRevision: changedA }), 'conflict')
assert.equal(saveDecision({ pathChanged: false, baseRevision: cleanA, sessionRevision: cleanA, deleted: true, diskRevision: null, force: true }), 'write')

// Existing managed resources need both lexical and real-path containment: a
// symlink/junction that leads outside the document folder must be rejected.
assert.equal(realPathIsWithin('C:\\Docs\\Note', 'c:\\docs\\note\\assets\\image.png', true), true)
assert.equal(realPathIsWithin('C:\\Docs\\Note', 'C:\\Outside\\image.png', true), false)
assert.equal(realPathIsWithin('C:\\Docs\\Note', 'C:\\Docs\\Note', true), false)

// A future Save As path gets ownership from its nearest real ancestor, so
// alias and real spelling cannot run independent path queues.
const nativeRoot = path.parse(process.cwd()).root
const aliasRoot = path.join(nativeRoot, 'Alias')
const realRoot = path.join(nativeRoot, 'RealRoot')
const futurePath = path.join(aliasRoot, 'drafts', 'future.md')
const canonicalFuturePath = path.join(realRoot, 'drafts', 'future.md')
const realAncestors = new Map([[aliasRoot, realRoot]])
const resolveAncestor = (value) => realAncestors.get(value) ?? null
assert.equal(canonicalPotentialPath(futurePath, resolveAncestor), canonicalFuturePath)
assert.equal(canonicalPotentialPathKey(futurePath, resolveAncestor, true), canonicalFuturePath.toLocaleLowerCase())
const noteA = path.join(nativeRoot, 'Notes', 'a.md')
const noteB = path.join(nativeRoot, 'Notes', 'b.md')
assert.equal(canForceConflictedTarget(true, noteA, null, noteA), false)
assert.equal(canForceConflictedTarget(true, noteB, noteA, noteA), false)
assert.equal(canForceConflictedTarget(true, noteA, noteA, noteA), true)
if (process.platform === 'win32') {
  assert.equal(canForceConflictedTarget(true, 'c:\\notes\\a.md', 'C:\\Notes\\A.md', 'C:\\Notes\\a.md'), true)
}

// Split mode serializes the textarea. Rapid source events therefore retain the
// latest text even before a coalesced ProseMirror render runs; WYSIWYG edits
// first mirror back to the same textarea.
assert.equal(mirrorWysiwygToSource('old source', 'new WYSIWYG'), 'new WYSIWYG')
assert.equal(authoritativeContent('split', 'rapid source 2', 'stale WYSIWYG'), 'rapid source 2')
assert.equal(authoritativeContent('split', 'new WYSIWYG', 'new WYSIWYG'), 'new WYSIWYG')
assert.equal(authoritativeContent('source', 'new source', 'old WYSIWYG'), 'new source')

// Renderer save completion never cleans edits made while its IPC request was
// pending; only the exact captured version/content becomes last-saved.
assert.equal(remainsDirtyAfterSave(3, 3, 'saved', 'saved'), false)
assert.equal(remainsDirtyAfterSave(4, 3, 'saved plus typing', 'saved'), true)
assert.equal(remainsDirtyAfterSave(3, 3, 'different snapshot', 'saved'), true)
assert.equal(aggregateCloseCanComplete([{ dirty: false }, { dirty: false }]), true)
assert.equal(aggregateCloseCanComplete([{ dirty: false }, { dirty: true }]), false)

// An original-document external event detaches an old Save As target B before
// it installs A's conflict, so Keep Mine cannot retry B.
assert.equal(pendingConflictTarget('B.md', 'B.md'), 'B.md')
assert.equal(pendingConflictTarget(null, 'B.md'), 'B.md')
assert.equal(pendingConflictTarget(null, undefined), null)
assert.equal(sameConflictTarget('C:\\Notes\\A.md', 'c:/notes/a.md'), true)
assert.equal(conflictTargetToCancel('B.md', 'B.md', 'A.md', 'key-b', 'key-b', 'key-a'), 'B.md')
assert.equal(conflictTargetToCancel('C:\\Alias\\A.md', 'C:\\Alias\\A.md', 'C:\\Real\\A.md', 'key-a', 'key-a', 'key-a'), null)

// The clone sanitizer uses these production predicates to restore all
// collapsed content and remove editor-only controls before every exporter.
assert.equal(isEditorPresentationClass('colamd-section-hidden'), true)
assert.equal(isEditorPresentationClass('column-resize-handle'), true)
assert.equal(isEditorPresentationClass('document-content'), false)
assert.equal(isEditorPresentationAttribute('data-colamd-heading-toggle'), true)
assert.equal(isEditorPresentationAttribute('data-colwidth'), true)
assert.equal(isEditorPresentationAttribute('data-language'), false)

let collapsed = collapsedHeadingStep([], 1, true)
assert.equal(collapsed.hidden, false)
collapsed = collapsedHeadingStep(collapsed.ancestors, 2, false)
assert.equal(collapsed.hidden, true) // descendant heading is hidden
collapsed = collapsedHeadingStep(collapsed.ancestors, 1, false)
assert.equal(collapsed.hidden, false) // equal-level boundary remains visible

// Downward drops land after the full target subtree; upward drops land before it.
assert.equal(sectionMoveInsertion({ start: 0, end: 10 }, { start: 10, end: 30 }), 20)
assert.equal(sectionMoveInsertion({ start: 20, end: 30 }, { start: 0, end: 20 }), 0)
assert.equal(sectionMoveInsertion({ start: 0, end: 30 }, { start: 10, end: 20 }), null)

// Production outline boundaries are derived from ordered top-level headings,
// selecting the first equal-or-higher heading rather than a later sibling.
const boundaries = [{ position: 0, level: 1 }, { position: 8, level: 2 }, { position: 16, level: 2 }, { position: 24, level: 1 }]
assert.equal(sectionEndFromHeadings(0, 1, 30, boundaries), 24)
assert.equal(sectionEndFromHeadings(8, 2, 30, boundaries), 16)
assert.equal(sectionEndFromHeadings(16, 2, 30, boundaries), 24)

// Codex sends the exact source selection and the complete current heading
// section, stopping before the next heading at the same or a higher level.
const codexMarkdown = '# Intro\nlead\n\n## Work\nselected text\n\n### Detail\nmore\n\n## Next\nend\n'
assert.deepEqual(sourceSelectionContext(codexMarkdown, codexMarkdown.indexOf('selected'), codexMarkdown.indexOf('selected') + 8), { selectedText: 'selected', line: 5 })
assert.deepEqual(markdownSectionAtLine(codexMarkdown, 7), { heading: 'Detail', content: '### Detail\nmore' })
assert.deepEqual(markdownSectionAtLine(codexMarkdown, 5), { heading: 'Work', content: '## Work\nselected text\n\n### Detail\nmore' })

// New installs keep the optional Codex bridge off, while persisted appearance
// values are validated and clamped before they reach renderer CSS.
assert.equal(normalizeAppSettings({}).codexEnabled, false)
assert.equal(normalizeAppSettings({ codexEnabled: true }).codexEnabled, true)
assert.equal(normalizeAppSettings({ fontSize: 99 }).fontSize, 24)
assert.equal(normalizeAppSettings({ lineHeight: 0 }).lineHeight, 1.4)
assert.equal(normalizeAppSettings({ editorFont: 'comic', contentWidth: 'tiny' }).editorFont, DEFAULT_APP_SETTINGS.editorFont)
assert.deepEqual(mergeAppSettings(DEFAULT_APP_SETTINGS, { theme: 'dark', autosave: true }), { ...DEFAULT_APP_SETTINGS, theme: 'dark', autosave: true })

console.log('document-session regression: persistence, settings, split sync, outline boundaries, and Codex context passed')

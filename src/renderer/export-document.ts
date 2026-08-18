export interface ExportDocumentPayload {
  title: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function collectDocumentStyles(): string {
  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) rules.push(rule.cssText)
    } catch {
      // Ignore stylesheets whose rules cannot be read. QuillMesh's bundled and
      // user-imported theme styles are same-origin and normally readable.
    }
  }
  return rules.join('\n')
}

const editorPresentationClasses = new Set([
  'colamd-section-hidden', 'colamd-heading-collapsed', 'colamd-code-wrap',
  'colamd-table-tools', 'colamd-code-tools', 'colamd-incremental-block',
  'column-resize-handle', 'resize-cursor', 'focus-active',
  'ProseMirror-focused', 'ProseMirror-selectednode', 'selectedCell',
])

/** Used by the export clone and the deterministic regression smoke test. */
export function isEditorPresentationClass(name: string): boolean {
  return name.startsWith('colamd-') || editorPresentationClasses.has(name)
}

export function isEditorPresentationAttribute(name: string): boolean {
  return name.startsWith('data-colamd-') || name === 'data-colwidth' || name === 'colwidth'
}

function sanitizeClone(root: HTMLElement): void {
  root.removeAttribute('contenteditable')
  root.removeAttribute('spellcheck')
  root.removeAttribute('tabindex')
  root.classList.remove('ProseMirror-focused')

  // Collapse, table/code toolbars, and resize handles are all presentation
  // affordances. Removing them from the clone ensures every exporter sees the
  // complete document rather than an editor-specific collapsed snapshot.
  root.querySelectorAll('script, iframe, object, embed, .heading-collapse-toggle, .colamd-table-tools, .colamd-code-tools, .column-resize-handle, .mermaid-toolbar').forEach((element) => element.remove())
  root.querySelectorAll('colgroup').forEach((element) => element.remove())
  // The code/preview toggle is an editor view state; exports always include
  // the rendered diagram regardless of the toggle the user last touched.
  root.querySelectorAll<HTMLElement>('.mermaid-body[hidden]').forEach((element) => element.removeAttribute('hidden'))
  root.querySelectorAll<HTMLElement>('.tableWrapper').forEach((wrapper) => {
    const parent = wrapper.parentElement
    if (!parent) { wrapper.remove(); return }
    while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper)
    wrapper.remove()
  })

  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const hadHeadingPresentation = element.hasAttribute('data-colamd-heading-toggle')
    element.removeAttribute('contenteditable')
    element.removeAttribute('spellcheck')
    element.removeAttribute('tabindex')
    if (hadHeadingPresentation) element.removeAttribute('title')
    for (const className of Array.from(element.classList)) {
      if (isEditorPresentationClass(className)) element.classList.remove(className)
    }

    for (const attribute of Array.from(element.attributes)) {
      if (isEditorPresentationAttribute(attribute.name)) element.removeAttribute(attribute.name)
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
      if ((attribute.name === 'href' || attribute.name === 'src') && /^\s*javascript:/i.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  root.querySelectorAll<HTMLLIElement>('li[data-item-type="task"]').forEach((item) => {
    const marker = document.createElement('span')
    marker.className = 'export-task-marker'
    marker.textContent = item.dataset.checked === 'true' ? '☑ ' : '☐ '
    item.prepend(marker)
  })

  // 引文标注：编辑器里用 CSS 隐藏 [@key] 源码、以 ::after 显示标签（@作者 / [编号]）。
  // 导出时把标签固化为纯文本并去掉标注类，确保 Word 等不理解 ::after 的格式也能看到，
  // 且与编辑器当前显示样式完全一致。
  root.querySelectorAll<HTMLElement>('.cite-mark').forEach((mark) => {
    mark.textContent = mark.dataset.citeLabel ?? mark.textContent
    mark.classList.remove('cite-mark', 'cite-mark-missing')
    mark.removeAttribute('data-cite-keys')
    mark.removeAttribute('data-cite-label')
  })
}

export function buildExportDocument(editor: HTMLElement, title: string): ExportDocumentPayload {
  const source = editor.querySelector<HTMLElement>('.ProseMirror')
  if (!source) throw new Error('The editor is not ready for export.')

  const clone = source.cloneNode(true) as HTMLElement
  sanitizeClone(clone)

  const bodyClasses = Array.from(document.body.classList).filter((name) =>
    name.startsWith('theme-') || name === 'show-equation-numbers'
  )
  const language = document.documentElement.lang || 'en'
  const styles = collectDocumentStyles()
  const safeTitle = escapeHtml(title || 'QuillMesh Document')

  const exportStyles = `
    html, body { height: auto !important; min-height: 100%; overflow: visible !important; }
    body { margin: 0; background: var(--bg-color); color: var(--text-color); }
    #export-shell { width: 100%; padding: 48px 56px 64px; }
    #editor { height: auto !important; overflow: visible !important; padding: 0 !important; }
    #editor .ProseMirror { min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }
    #editor .ProseMirror > * { opacity: 1 !important; }
    #editor .ProseMirror .colamd-section-hidden { display: block !important; }
    #editor .ProseMirror img { cursor: default; }
    #editor .ProseMirror li[data-item-type="task"]::before { display: none !important; }
    #editor .ProseMirror .export-task-marker { text-decoration: none; color: var(--text-color); }
    @page { size: A4; margin: 18mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      #export-shell { padding: 0; }
      #editor .ProseMirror { max-width: none; }
    }
  `

  return {
    title: title || 'QuillMesh Document',
    html: `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: file:; style-src 'unsafe-inline'; font-src data: file:;">
  <title>${safeTitle}</title>
  <style>${styles}\n${exportStyles}</style>
</head>
<body class="${bodyClasses.map(escapeHtml).join(' ')}">
  <main id="export-shell"><div id="editor">${clone.outerHTML}</div></main>
</body>
</html>`
  }
}

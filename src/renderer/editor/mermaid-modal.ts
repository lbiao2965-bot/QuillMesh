import { getEditorView } from './editor'
import { t } from '../i18n'
import { iconSvg } from '../icons'
import { renderMermaidPreview } from './mermaid-view'

/**
 * Draggable "source + live preview" editor for a Mermaid code block, opened by
 * double-clicking a rendered diagram (or via its context menu). Mirrors the
 * math modal's visual language so all floating cards feel like one family.
 */
export class MermaidModal {
  private container: HTMLDivElement
  private modal!: HTMLDivElement
  private input: HTMLTextAreaElement
  private header: HTMLHeadingElement
  private previewLabel: HTMLDivElement
  private preview: HTMLDivElement
  private cancelButton: HTMLButtonElement
  private saveButton: HTMLButtonElement
  private targetPos: number | null = null
  private previewTimer: number | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'math-modal-overlay'
    this.container.style.display = 'none'

    const modal = document.createElement('div')
    modal.className = 'math-modal mermaid-modal'
    this.modal = modal

    this.header = document.createElement('h3')
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'math-modal-close'
    closeButton.innerHTML = iconSvg('x', 13)
    closeButton.addEventListener('click', () => this.hide())

    const headerBar = document.createElement('div')
    headerBar.className = 'math-modal-header'
    headerBar.append(this.header, closeButton)
    this.makeDraggable(headerBar)

    this.input = document.createElement('textarea')
    this.input.className = 'math-modal-input mermaid-modal-input'
    this.input.rows = 9
    this.input.spellcheck = false
    this.input.addEventListener('input', () => this.schedulePreview())

    const previewSection = document.createElement('div')
    previewSection.className = 'math-modal-preview-section'

    this.previewLabel = document.createElement('div')
    this.previewLabel.className = 'math-modal-preview-label'

    this.preview = document.createElement('div')
    this.preview.className = 'math-modal-preview mermaid-modal-preview'
    this.preview.setAttribute('aria-live', 'polite')
    previewSection.append(this.previewLabel, this.preview)

    const footer = document.createElement('div')
    footer.className = 'math-modal-footer'

    this.cancelButton = document.createElement('button')
    this.cancelButton.className = 'math-modal-btn cancel'
    this.cancelButton.addEventListener('click', () => this.hide())

    this.saveButton = document.createElement('button')
    this.saveButton.className = 'math-modal-btn save'
    this.saveButton.addEventListener('click', () => this.save())

    footer.append(this.cancelButton, this.saveButton)
    modal.append(headerBar, this.input, previewSection, footer)
    this.container.appendChild(modal)
    this.applyLanguage()
    window.addEventListener('colamd-language-changed', () => this.applyLanguage())

    this.container.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.hide()
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        this.save()
      }
    })

    document.body.appendChild(this.container)
  }

  private applyLanguage(): void {
    this.header.textContent = t('mermaidModalTitle')
    this.input.placeholder = t('mermaidPlaceholder')
    this.previewLabel.textContent = t('formulaPreview')
    this.cancelButton.textContent = t('cancel')
    this.saveButton.textContent = t('insertUpdate')
  }

  show(source: string, pos: number): void {
    this.targetPos = pos
    this.input.value = source
    this.container.style.display = 'flex'
    this.renderPreview()
    setTimeout(() => {
      this.input.focus()
      this.input.select()
    }, 50)
  }

  hide(): void {
    this.container.style.display = 'none'
    this.targetPos = null
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer)
      this.previewTimer = null
    }
    const view = getEditorView()
    if (view) view.focus()
  }

  private makeDraggable(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      const rect = this.modal.getBoundingClientRect()
      this.modal.style.position = 'absolute'
      this.modal.style.left = `${rect.left}px`
      this.modal.style.top = `${rect.top}px`
      this.modal.style.margin = '0'
      const offsetX = e.clientX - rect.left
      const offsetY = e.clientY - rect.top
      const onMove = (ev: PointerEvent) => {
        const x = Math.min(Math.max(ev.clientX - offsetX, 8), window.innerWidth - rect.width - 8)
        const y = Math.min(Math.max(ev.clientY - offsetY, 8), window.innerHeight - rect.height - 8)
        this.modal.style.left = `${x}px`
        this.modal.style.top = `${y}px`
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    })
  }

  private schedulePreview(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer)
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null
      this.renderPreview()
    }, 400)
  }

  private renderPreview(): void {
    const value = this.input.value.trim()
    this.preview.classList.remove('error', 'empty')
    this.preview.replaceChildren()

    if (!value) {
      this.preview.textContent = t('mermaidPlaceholder')
      this.preview.classList.add('empty')
      this.saveButton.disabled = false
      return
    }

    const result = renderMermaidPreview(value)
    if (result.status === 'pending') {
      this.preview.textContent = t('mermaidRendering')
      this.preview.classList.add('empty')
      // The render helper notifies us through this event once resolved.
      const onDone = () => {
        if (this.container.style.display === 'none') return
        this.renderPreview()
      }
      window.addEventListener('quill-mermaid-rendered', onDone, { once: true })
      return
    }
    if (result.status === 'error') {
      const label = document.createElement('div')
      label.className = 'mermaid-error-label'
      label.textContent = t('mermaidError')
      const detail = document.createElement('pre')
      detail.className = 'mermaid-error-detail'
      detail.textContent = result.message
      this.preview.append(label, detail)
      this.preview.classList.add('error')
      this.saveButton.disabled = true
      return
    }
    this.preview.innerHTML = result.svg
    this.saveButton.disabled = false
  }

  private save(): void {
    const value = this.input.value.replace(/\s+$/, '')
    const view = getEditorView()
    if (!view || this.targetPos === null) {
      this.hide()
      return
    }
    const pos = this.targetPos
    const node = view.state.doc.nodeAt(pos)
    if (node && node.type.name === 'code_block' && String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid') {
      const tr = view.state.tr.insertText(value, pos + 1, pos + node.nodeSize - 1)
      view.dispatch(tr)
    }
    this.hide()
  }
}

export const mermaidModal = new MermaidModal()

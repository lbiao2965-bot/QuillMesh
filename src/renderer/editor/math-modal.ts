import { getEditorView } from './editor'
import { t } from '../i18n'
import { iconSvg } from '../icons'
import katex from 'katex'

function normalizeFormulaInput(input: string): string {
  let value = input.trim()
  if (value.length >= 4 && value.startsWith('$$') && value.endsWith('$$')) {
    value = value.slice(2, -2).trim()
  } else if (value.length >= 2 && value.startsWith('$') && value.endsWith('$')) {
    value = value.slice(1, -1).trim()
  }
  return value
}

export class MathModal {
  private container: HTMLDivElement
  private modal!: HTMLDivElement
  private input: HTMLTextAreaElement
  private isBlockCheckbox: HTMLInputElement
  private header: HTMLHeadingElement
  private previewLabel: HTMLDivElement
  private preview: HTMLDivElement
  private blockLabel: HTMLLabelElement
  private cancelButton: HTMLButtonElement
  private saveButton: HTMLButtonElement
  private currentTarget: { pos: number; isBlock: boolean } | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'math-modal-overlay'
    this.container.style.display = 'none'

    const modal = document.createElement('div')
    modal.className = 'math-modal'
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
    this.input.className = 'math-modal-input'
    this.input.rows = 4
    this.input.addEventListener('input', () => this.renderPreview())

    const previewSection = document.createElement('div')
    previewSection.className = 'math-modal-preview-section'

    this.previewLabel = document.createElement('div')
    this.previewLabel.className = 'math-modal-preview-label'

    this.preview = document.createElement('div')
    this.preview.className = 'math-modal-preview'
    this.preview.setAttribute('aria-live', 'polite')
    previewSection.append(this.previewLabel, this.preview)

    const options = document.createElement('div')
    options.className = 'math-modal-options'

    this.isBlockCheckbox = document.createElement('input')
    this.isBlockCheckbox.type = 'checkbox'
    this.isBlockCheckbox.id = 'math-is-block'
    this.isBlockCheckbox.addEventListener('change', () => this.renderPreview())

    this.blockLabel = document.createElement('label')
    this.blockLabel.htmlFor = 'math-is-block'

    options.append(this.isBlockCheckbox, this.blockLabel)

    const footer = document.createElement('div')
    footer.className = 'math-modal-footer'

    this.cancelButton = document.createElement('button')
    this.cancelButton.className = 'math-modal-btn cancel'
    this.cancelButton.addEventListener('click', () => this.hide())

    this.saveButton = document.createElement('button')
    this.saveButton.className = 'math-modal-btn save'
    this.saveButton.addEventListener('click', () => this.save())

    footer.append(this.cancelButton, this.saveButton)
    modal.append(headerBar, this.input, previewSection, options, footer)
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
    this.header.textContent = t('editFormula')
    this.input.placeholder = t('formulaPlaceholder')
    this.previewLabel.textContent = t('formulaPreview')
    this.blockLabel.textContent = ` ${t('displayBlockFormula')}`
    this.cancelButton.textContent = t('cancel')
    this.saveButton.textContent = t('insertUpdate')
    this.renderPreview()
  }

  show(initialValue = '', isBlock = false, targetPos: number | null = null): void {
    this.currentTarget = targetPos !== null ? { pos: targetPos, isBlock } : null
    this.input.value = initialValue
    this.isBlockCheckbox.checked = isBlock
    this.renderPreview()

    this.container.style.display = 'flex'

    setTimeout(() => {
      this.input.focus()
      if (initialValue) this.input.select()
    }, 50)
  }

  hide(): void {
    this.container.style.display = 'none'
    this.currentTarget = null
    const sourceEditor = this.getSourceEditor()
    if (sourceEditor) {
      sourceEditor.focus()
      return
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

  private renderPreview(): void {
    const value = normalizeFormulaInput(this.input.value)
    this.preview.classList.remove('error')
    this.preview.replaceChildren()

    if (!value) {
      this.preview.textContent = t('formulaPreviewEmpty')
      this.preview.classList.add('empty')
      this.saveButton.disabled = false
      return
    }

    this.preview.classList.remove('empty')
    try {
      katex.render(value, this.preview, {
        throwOnError: true,
        displayMode: this.isBlockCheckbox.checked,
      })
      this.saveButton.disabled = false
    } catch {
      this.preview.textContent = t('formulaInvalid')
      this.preview.classList.add('error')
      this.saveButton.disabled = true
    }
  }

  private save(): void {
    const value = normalizeFormulaInput(this.input.value)
    const isBlock = this.isBlockCheckbox.checked
    const sourceEditor = this.getSourceEditor()

    if (sourceEditor && this.currentTarget === null) {
      if (value) {
        const formula = isBlock ? `\n$$\n${value}\n$$\n` : `$${value}$`
        sourceEditor.setRangeText(
          formula,
          sourceEditor.selectionStart,
          sourceEditor.selectionEnd,
          'end'
        )
        sourceEditor.dispatchEvent(new Event('input', { bubbles: true }))
      }
      this.hide()
      return
    }

    const view = getEditorView()

    if (!view) {
      this.hide()
      return
    }

    const tr = view.state.tr
    const schema = view.state.schema
    const nodeType = isBlock ? schema.nodes.math_block : schema.nodes.math_inline

    if (!nodeType) {
      console.error('Math schema nodes not found. Is the math plugin loaded?')
      this.hide()
      return
    }

    if (this.currentTarget !== null) {
      const { pos, isBlock: wasBlock } = this.currentTarget
      const node = view.state.doc.nodeAt(pos)

      if (node && (node.type.name === 'math_inline' || node.type.name === 'math_block')) {
        if (!value) {
          tr.delete(pos, pos + node.nodeSize)
        } else if (isBlock === wasBlock) {
          if (isBlock) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, value })
          } else {
            tr.replaceWith(pos, pos + node.nodeSize, nodeType.create(null, schema.text(value)))
          }
        } else if (isBlock) {
          tr.replaceWith(pos, pos + node.nodeSize, nodeType.create({ value }))
        } else {
          tr.replaceWith(pos, pos + node.nodeSize, nodeType.create(null, schema.text(value)))
        }
      }
    } else if (value) {
      const insertNode = isBlock ? nodeType.create({ value }) : nodeType.create(null, schema.text(value))
      tr.replaceSelectionWith(insertNode)
    }

    view.dispatch(tr)
    this.hide()
  }

  private getSourceEditor(): HTMLTextAreaElement | null {
    const sourceEditor = document.getElementById('source-editor') as HTMLTextAreaElement | null
    return sourceEditor?.classList.contains('visible') ? sourceEditor : null
  }
}

export const mathModal = new MathModal()

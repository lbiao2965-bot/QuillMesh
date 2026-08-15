import { getEditorView } from './editor'
import { t } from '../i18n'
import { iconSvg } from '../icons'
import {
  autocompleteCommands,
  snippetCursorIndex,
  symbolData,
  symbolTabs,
  withoutSnippetCursor,
  type SymbolTab,
} from './math-symbols'
import type { TranslationKey } from '../../shared/i18n'
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

const tabLabelKeys: Record<SymbolTab, TranslationKey> = {
  common: 'mathTabCommon',
  greek: 'mathTabGreek',
  sets: 'mathTabSets',
  calculus: 'mathTabCalculus',
  templates: 'mathTabTemplates',
  favorites: 'mathTabFavorites',
  recent: 'mathTabRecent',
}

const FAVORITES_KEY = 'quillmesh-math-favorites'
const RECENTS_KEY = 'quillmesh-math-recents'
const MAX_RECENTS = 12

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
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
  private favButton: HTMLButtonElement
  private tabRow: HTMLDivElement
  private panel: HTMLDivElement
  private suggestBox: HTMLDivElement
  private symbolTip: HTMLDivElement
  private activeTab: SymbolTab | null = null
  private favorites: string[] = readList(FAVORITES_KEY)
  private recents: string[] = readList(RECENTS_KEY)
  private suggestions: string[] = []
  private suggestIndex = 0
  private suggestPrefix = ''
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
    this.favButton = document.createElement('button')
    this.favButton.type = 'button'
    this.favButton.className = 'math-fav-btn'
    this.favButton.innerHTML = iconSvg('star', 14)
    this.favButton.addEventListener('click', () => this.toggleFavorite())

    const headerBar = document.createElement('div')
    headerBar.className = 'math-modal-header'
    headerBar.append(this.header, this.favButton, closeButton)
    this.makeDraggable(headerBar)

    this.input = document.createElement('textarea')
    this.input.className = 'math-modal-input'
    this.input.rows = 4
    this.input.spellcheck = false
    this.input.addEventListener('input', () => {
      this.renderPreview()
      this.updateSuggestions()
    })
    this.input.addEventListener('keydown', (e) => this.onInputKeydown(e))
    this.input.addEventListener('blur', () => this.hideSuggestions())

    // ---- 公式助手：符号 / 模板 / 收藏 / 最近 ----
    const assistant = document.createElement('div')
    assistant.className = 'math-assistant'

    this.tabRow = document.createElement('div')
    this.tabRow.className = 'math-assistant-tabs'
    for (const tab of symbolTabs) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'math-assistant-tab'
      button.dataset.tab = tab
      button.addEventListener('click', () => this.toggleTab(tab))
      this.tabRow.appendChild(button)
    }

    this.panel = document.createElement('div')
    this.panel.className = 'math-assistant-panel'
    this.panel.hidden = true
    this.panel.addEventListener('scroll', () => this.hideSymbolTip())

    assistant.append(this.tabRow, this.panel)

    this.suggestBox = document.createElement('div')
    this.suggestBox.className = 'math-suggest'
    this.suggestBox.hidden = true

    this.symbolTip = document.createElement('div')
    this.symbolTip.className = 'math-symbol-tip'
    this.symbolTip.hidden = true

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
    modal.append(headerBar, this.input, assistant, previewSection, options, footer)
    modal.append(this.suggestBox, this.symbolTip)
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
    this.favButton.title = t('mathFavoriteAdd')
    this.favButton.setAttribute('aria-label', t('mathFavoriteAdd'))
    for (const button of this.tabRow.querySelectorAll<HTMLButtonElement>('.math-assistant-tab')) {
      const tab = button.dataset.tab as SymbolTab
      button.textContent = t(tabLabelKeys[tab])
    }
    if (this.activeTab) this.renderPanel()
    this.renderPreview()
  }

  show(initialValue = '', isBlock = false, targetPos: number | null = null): void {
    this.currentTarget = targetPos !== null ? { pos: targetPos, isBlock } : null
    this.input.value = initialValue
    this.isBlockCheckbox.checked = isBlock
    this.hideSuggestions()
    this.syncFavButton()
    if (this.activeTab === 'favorites' || this.activeTab === 'recent') this.renderPanel()
    this.renderPreview()

    this.container.style.display = 'flex'

    setTimeout(() => {
      this.input.focus()
      if (initialValue) this.input.select()
    }, 50)
  }

  hide(): void {
    this.container.style.display = 'none'
    this.hideSuggestions()
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

  // ---------- 公式助手 ----------

  private toggleTab(tab: SymbolTab): void {
    this.activeTab = this.activeTab === tab ? null : tab
    for (const button of this.tabRow.querySelectorAll<HTMLButtonElement>('.math-assistant-tab')) {
      button.classList.toggle('active', button.dataset.tab === this.activeTab)
    }
    if (this.activeTab) {
      this.panel.hidden = false
      this.renderPanel()
    } else {
      this.panel.hidden = true
    }
  }

  private renderPanel(): void {
    const tab = this.activeTab
    if (!tab) return
    this.hideSymbolTip()
    this.panel.replaceChildren()

    if (tab === 'favorites' || tab === 'recent') {
      const list = tab === 'favorites' ? this.favorites : this.recents
      if (!list.length) {
        const empty = document.createElement('div')
        empty.className = 'math-assistant-empty'
        empty.textContent = t('mathEmptyList')
        this.panel.appendChild(empty)
        return
      }
      for (const formula of list) {
        const chip = document.createElement('div')
        chip.className = 'math-chip'
        const insert = document.createElement('button')
        insert.type = 'button'
        insert.className = 'math-chip-insert'
        try {
          katex.render(formula, insert, { throwOnError: true })
        } catch {
          insert.textContent = formula
        }
        insert.title = formula
        insert.addEventListener('mousedown', (e) => e.preventDefault())
        insert.addEventListener('click', () => this.insertSnippet(formula))
        chip.appendChild(insert)
        if (tab === 'favorites') {
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.className = 'math-chip-remove'
          remove.innerHTML = iconSvg('x', 11)
          remove.title = t('mathRemove')
          remove.setAttribute('aria-label', t('mathRemove'))
          remove.addEventListener('click', () => {
            this.favorites = this.favorites.filter((v) => v !== formula)
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites))
            this.syncFavButton()
            this.renderPanel()
          })
          chip.appendChild(remove)
        }
        this.panel.appendChild(chip)
      }
      return
    }

    const grid = document.createElement('div')
    grid.className = 'math-symbol-grid'
    for (const item of symbolData[tab]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'math-symbol-btn'
      const demo = item.demo ?? withoutSnippetCursor(item.latex)
      const compact = item.compact ?? demo
      if (item.compact) button.classList.add('wide')
      try {
        katex.render(compact, button, { throwOnError: true })
      } catch {
        button.textContent = item.glyph
      }
      button.title = item.title ?? withoutSnippetCursor(item.latex).trim()
      button.addEventListener('mousedown', (e) => e.preventDefault())
      button.addEventListener('click', () => this.insertSnippet(item.latex))
      button.addEventListener('mouseenter', () => this.showSymbolTip(button, demo, item))
      button.addEventListener('mouseleave', () => this.hideSymbolTip())
      grid.appendChild(button)
    }
    this.panel.appendChild(grid)
  }

  private showSymbolTip(button: HTMLButtonElement, demo: string, item: { glyph: string; latex: string }): void {
    this.symbolTip.replaceChildren()
    const render = document.createElement('span')
    render.className = 'math-symbol-tip-render'
    try {
      katex.render(demo, render, { throwOnError: true })
    } catch {
      render.textContent = item.glyph
    }
    const caption = document.createElement('span')
    caption.className = 'math-symbol-tip-cmd'
    caption.textContent = withoutSnippetCursor(item.latex).trim()
    this.symbolTip.append(render, caption)
    this.symbolTip.hidden = false

    const btnRect = button.getBoundingClientRect()
    const modalRect = this.modal.getBoundingClientRect()
    const tipWidth = this.symbolTip.offsetWidth
    const tipHeight = this.symbolTip.offsetHeight
    let left = btnRect.left - modalRect.left + btnRect.width / 2 - tipWidth / 2
    left = Math.min(Math.max(left, 4), modalRect.width - tipWidth - 4)
    let top = btnRect.top - modalRect.top - tipHeight - 6
    if (top < 4) top = btnRect.top - modalRect.top + btnRect.height + 6
    this.symbolTip.style.left = `${left}px`
    this.symbolTip.style.top = `${top}px`
  }

  private hideSymbolTip(): void {
    this.symbolTip.hidden = true
  }

  /**
   * 在光标处插入片段。| 为插入后光标位置；
   * 有选中文字时优先包裹进 {|} 组，再把下一个空组 {} 作为新光标位。
   */
  private insertSnippet(snippet: string): void {
    const input = this.input
    const start = input.selectionStart
    const end = input.selectionEnd
    const selected = input.value.slice(start, end)

    let text = snippet
    if (selected && text.includes('{|}')) {
      text = text.replace('{|}', `{${selected}}`)
      if (text.includes('{}')) text = text.replace('{}', '{|}')
    }
    const marker = snippetCursorIndex(text)
    if (marker >= 0) text = text.slice(0, marker) + text.slice(marker + 1)

    input.value = input.value.slice(0, start) + text + input.value.slice(end)
    const pos = start + (marker >= 0 ? marker : text.length)
    input.focus()
    input.setSelectionRange(pos, pos)
    this.renderPreview()
  }

  // ---------- \alp 自动补全 ----------

  private updateSuggestions(): void {
    const pos = this.input.selectionStart
    const upto = this.input.value.slice(0, pos)
    const match = upto.match(/\\([A-Za-z]{2,})$/)
    if (!match) {
      this.hideSuggestions()
      return
    }
    const prefix = match[1]
    const matches = autocompleteCommands
      .filter((c) => c.startsWith(prefix) && c !== prefix)
      .slice(0, 8)
    if (!matches.length) {
      this.hideSuggestions()
      return
    }
    this.suggestions = matches
    this.suggestPrefix = prefix
    this.suggestIndex = 0
    this.renderSuggestions()
  }

  private renderSuggestions(): void {
    this.suggestBox.replaceChildren()
    this.suggestions.forEach((cmd, index) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'math-suggest-item'
      item.classList.toggle('active', index === this.suggestIndex)
      item.textContent = `\\${cmd}`
      item.addEventListener('mousedown', (e) => e.preventDefault())
      item.addEventListener('click', () => {
        this.suggestIndex = index
        this.acceptSuggestion()
      })
      this.suggestBox.appendChild(item)
    })
    this.suggestBox.style.top = `${this.input.offsetTop + this.input.offsetHeight + 4}px`
    this.suggestBox.style.left = `${this.input.offsetLeft}px`
    this.suggestBox.hidden = false
  }

  private acceptSuggestion(): void {
    const cmd = this.suggestions[this.suggestIndex]
    if (!cmd) return
    const pos = this.input.selectionStart
    const replaceFrom = pos - this.suggestPrefix.length - 1
    this.input.value = this.input.value.slice(0, replaceFrom) + `\\${cmd} ` + this.input.value.slice(pos)
    const cursor = replaceFrom + cmd.length + 2
    this.input.setSelectionRange(cursor, cursor)
    this.hideSuggestions()
    this.renderPreview()
  }

  private hideSuggestions(): void {
    this.suggestions = []
    this.suggestBox.hidden = true
  }

  private onInputKeydown(e: KeyboardEvent): void {
    if (!this.suggestions.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      this.suggestIndex = (this.suggestIndex + delta + this.suggestions.length) % this.suggestions.length
      this.renderSuggestions()
    } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      this.acceptSuggestion()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.hideSuggestions()
    }
  }

  // ---------- 收藏与最近使用 ----------

  private toggleFavorite(): void {
    const value = normalizeFormulaInput(this.input.value)
    if (!value) return
    if (this.favorites.includes(value)) {
      this.favorites = this.favorites.filter((v) => v !== value)
    } else {
      this.favorites = [value, ...this.favorites].slice(0, 24)
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites))
    this.syncFavButton()
    if (this.activeTab === 'favorites') this.renderPanel()
  }

  private syncFavButton(): void {
    const value = normalizeFormulaInput(this.input.value)
    this.favButton.classList.toggle('active', !!value && this.favorites.includes(value))
  }

  private rememberRecent(value: string): void {
    if (!value) return
    this.recents = [value, ...this.recents.filter((v) => v !== value)].slice(0, MAX_RECENTS)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents))
    if (this.activeTab === 'recent') this.renderPanel()
  }

  // ---------- 预览与保存 ----------

  private renderPreview(): void {
    const value = normalizeFormulaInput(this.input.value)
    this.preview.classList.remove('error')
    this.preview.replaceChildren()
    this.syncFavButton()

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
    this.rememberRecent(value)

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

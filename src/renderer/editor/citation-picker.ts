import { addBibliographyEntries, getBibliographyEntries, getBibliographyPath, parseBibTeX, type BibEntry } from '../citations'
import { getEditorView } from './editor'
import { t } from '../i18n'
import { iconSvg } from '../icons'

/**
 * "插入引文"弹窗：搜索并选择文献库条目插入为 [@key]；
 * 底部可直接粘贴 BibTeX 新增条目，新增后立即出现在列表中并选中。
 */
export class CitationPicker {
  private container: HTMLDivElement
  private modal!: HTMLDivElement
  private header: HTMLHeadingElement
  private search: HTMLInputElement
  private list: HTMLDivElement
  private addToggle: HTMLButtonElement
  private addArea: HTMLDivElement
  private addInput: HTMLTextAreaElement
  private addSummary: HTMLDivElement
  private addConfirm: HTMLButtonElement
  private cancelButton: HTMLButtonElement
  private insertButton: HTMLButtonElement
  private filtered: BibEntry[] = []
  private activeIndex = -1
  private selectedKey: string | null = null
  private range: { from: number; to: number } | null = null
  private documentId: string | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'math-modal-overlay'
    this.container.style.display = 'none'

    const modal = document.createElement('div')
    modal.className = 'math-modal citation-picker'
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

    this.search = document.createElement('input')
    this.search.type = 'search'
    this.search.className = 'citation-picker-search'
    this.search.autocomplete = 'off'
    this.search.addEventListener('input', () => this.renderList())
    this.search.addEventListener('keydown', (e) => this.onSearchKeydown(e))

    this.list = document.createElement('div')
    this.list.className = 'citation-picker-list'
    this.list.setAttribute('role', 'listbox')

    // 新增区：与选择同一界面，展开即可粘贴 BibTeX
    this.addToggle = document.createElement('button')
    this.addToggle.type = 'button'
    this.addToggle.className = 'citation-picker-add-toggle'
    this.addToggle.addEventListener('click', () => this.toggleAddArea())

    this.addArea = document.createElement('div')
    this.addArea.className = 'citation-picker-add'
    this.addArea.hidden = true

    this.addInput = document.createElement('textarea')
    this.addInput.className = 'math-modal-input bibtex-modal-input'
    this.addInput.rows = 5
    this.addInput.spellcheck = false
    this.addInput.addEventListener('input', () => this.refreshAddSummary())

    this.addSummary = document.createElement('div')
    this.addSummary.className = 'bibtex-modal-summary'

    this.addConfirm = document.createElement('button')
    this.addConfirm.type = 'button'
    this.addConfirm.className = 'math-modal-btn save citation-picker-add-confirm'
    this.addConfirm.addEventListener('click', () => { void this.addEntries() })

    this.addArea.append(this.addInput, this.addSummary, this.addConfirm)

    const footer = document.createElement('div')
    footer.className = 'math-modal-footer'
    this.cancelButton = document.createElement('button')
    this.cancelButton.className = 'math-modal-btn cancel'
    this.cancelButton.addEventListener('click', () => this.hide())
    this.insertButton = document.createElement('button')
    this.insertButton.className = 'math-modal-btn save'
    this.insertButton.addEventListener('click', () => this.insert())
    footer.append(this.cancelButton, this.insertButton)

    modal.append(headerBar, this.search, this.list, this.addToggle, this.addArea, footer)
    this.container.appendChild(modal)
    this.applyLanguage()
    window.addEventListener('colamd-language-changed', () => this.applyLanguage())

    this.container.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.hide()
      }
    })
    document.body.appendChild(this.container)
  }

  private applyLanguage(): void {
    this.header.textContent = t('citationPickerTitle')
    this.search.placeholder = t('citationSearchPlaceholder')
    this.addInput.placeholder = t('bibtexPlaceholder')
    this.addToggle.textContent = `＋ ${t('addBibtexEntry')}`
    this.addConfirm.textContent = t('add')
    this.cancelButton.textContent = t('cancel')
    this.insertButton.textContent = t('insertAction')
    this.renderList()
    this.refreshAddSummary()
  }

  show(documentId: string | null, expandAdd = false): void {
    const view = getEditorView()
    this.documentId = documentId
    this.range = view ? { from: view.state.selection.from, to: view.state.selection.to } : null
    this.selectedKey = null
    this.search.value = ''
    this.addArea.hidden = !expandAdd
    this.addToggle.classList.toggle('open', expandAdd)
    this.container.style.display = 'flex'
    this.renderList()
    setTimeout(() => (expandAdd ? this.addInput : this.search).focus(), 50)
  }

  hide(): void {
    this.container.style.display = 'none'
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

  private filter(query: string): BibEntry[] {
    const all = getBibliographyEntries()
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((entry) =>
      entry.key.toLowerCase().includes(needle) ||
      entry.author.toLowerCase().includes(needle) ||
      entry.title.toLowerCase().includes(needle) ||
      entry.year.includes(needle))
  }

  private renderList(): void {
    this.filtered = this.filter(this.search.value)
    this.list.replaceChildren()
    if (!this.filtered.length) {
      const empty = document.createElement('div')
      empty.className = 'citation-picker-empty'
      empty.textContent = t('citationPickerEmpty')
      this.list.appendChild(empty)
    }
    this.filtered.forEach((entry, index) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'citation-picker-row'
      row.dataset.key = entry.key
      row.setAttribute('role', 'option')
      const key = document.createElement('span')
      key.className = 'citation-picker-key'
      key.textContent = `@${entry.key}`
      const caption = document.createElement('span')
      caption.className = 'citation-picker-caption'
      const authorYear = [entry.authors[0]?.family, entry.year].filter(Boolean).join(' ')
      caption.textContent = [authorYear, entry.title].filter(Boolean).join(' — ')
      row.append(key, caption)
      row.addEventListener('click', () => this.select(entry.key, index))
      row.addEventListener('dblclick', () => this.insert())
      this.list.appendChild(row)
    })
    // 保持已有选中；无选中时默认高亮第一条
    const kept = this.selectedKey ? this.filtered.findIndex((e) => e.key === this.selectedKey) : -1
    this.activeIndex = kept >= 0 ? kept : (this.filtered.length ? 0 : -1)
    if (kept < 0) this.selectedKey = this.filtered[0]?.key ?? null
    this.syncActive()
  }

  private syncActive(): void {
    const rows = this.list.querySelectorAll<HTMLButtonElement>('.citation-picker-row')
    rows.forEach((row, index) => {
      const active = index === this.activeIndex
      row.classList.toggle('active', active)
      row.setAttribute('aria-selected', String(active))
      if (active) row.scrollIntoView({ block: 'nearest' })
    })
    this.insertButton.disabled = this.selectedKey === null
  }

  private select(key: string, index: number): void {
    this.selectedKey = key
    this.activeIndex = index
    this.syncActive()
  }

  private onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!this.filtered.length) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      this.activeIndex = (this.activeIndex + delta + this.filtered.length) % this.filtered.length
      this.selectedKey = this.filtered[this.activeIndex]?.key ?? null
      this.syncActive()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.insert()
    }
  }

  private insert(): void {
    if (!this.selectedKey) return
    const view = getEditorView()
    if (view && this.range) {
      const docSize = view.state.doc.content.size
      const from = Math.min(this.range.from, docSize)
      const to = Math.min(this.range.to, docSize)
      view.dispatch(view.state.tr.insertText(`[@${this.selectedKey}]`, from, to))
    }
    this.hide()
  }

  // ---------- 新增 BibTeX ----------

  private toggleAddArea(): void {
    this.addArea.hidden = !this.addArea.hidden
    this.addToggle.classList.toggle('open', !this.addArea.hidden)
    if (!this.addArea.hidden) this.addInput.focus()
  }

  private refreshAddSummary(): void {
    const raw = this.addInput.value.trim()
    const parsed = raw ? parseBibTeX(raw) : []
    this.addSummary.replaceChildren()
    this.addSummary.classList.toggle('invalid', Boolean(raw) && !parsed.length)
    if (!raw) {
      this.addSummary.textContent = ''
    } else if (!parsed.length) {
      this.addSummary.textContent = t('bibtexInvalid')
    } else {
      for (const entry of parsed) {
        const chip = document.createElement('span')
        chip.className = 'bibtex-modal-chip'
        chip.textContent = `@${entry.key}`
        chip.title = entry.title
        this.addSummary.appendChild(chip)
      }
    }
    this.addConfirm.disabled = !parsed.length
  }

  private async addEntries(): Promise<void> {
    const raw = this.addInput.value.trim()
    const parsed = raw ? parseBibTeX(raw) : []
    if (!parsed.length) return
    const path = getBibliographyPath()
    if (path) {
      if (!/\.(bib|biblatex)$/i.test(path)) {
        window.dispatchEvent(new CustomEvent('quill-bibliography-save-failed'))
        return
      }
      const saved = this.documentId
        ? await window.electronAPI.appendBibliographyEntry(this.documentId, `\n${raw}\n`)
        : false
      if (!saved) {
        window.dispatchEvent(new CustomEvent('quill-bibliography-save-failed'))
        return
      }
    }
    addBibliographyEntries(parsed)
    window.dispatchEvent(new CustomEvent('quill-bibliography-added', { detail: parsed.length }))
    this.addInput.value = ''
    this.refreshAddSummary()
    // 新增条目立刻出现在列表并选中第一条
    this.selectedKey = parsed[0].key
    this.search.value = ''
    this.renderList()
  }
}

export const citationPicker = new CitationPicker()

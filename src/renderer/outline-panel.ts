import { getEditorView } from './editor/editor'

interface OutlineEntry {
  element: HTMLHeadingElement
  button: HTMLButtonElement
  position: number
}

export class OutlinePanel {
  private entries: OutlineEntry[] = []
  private scrollFrame: number | null = null

  constructor(
    private readonly editor: HTMLElement,
    private readonly list: HTMLElement,
    private readonly emptyState: HTMLElement,
    private readonly onMoveHeading?: (sourcePosition: number, targetPosition: number) => void,
    private readonly onNavigateHeading?: (position: number) => void,
  ) {
    this.editor.addEventListener('scroll', this.handleScroll, { passive: true })
  }

  render(enabled = true): void {
    this.entries = []
    this.list.replaceChildren()

    if (enabled) {
      const headings = this.editor.querySelectorAll<HTMLHeadingElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6')
      for (const heading of headings) {
        const text = heading.textContent?.trim()
        if (!text) continue
        const level = Number(heading.tagName.slice(1))
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'outline-item'
        button.textContent = text
        button.title = text
        button.dataset.level = String(level)
        button.style.setProperty('--outline-level', String(level))
        button.draggable = true
        button.addEventListener('click', () => {
          if (position >= 0) this.onNavigateHeading?.(position)
          window.requestAnimationFrame(() => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }))
          this.setActive(button)
        })
        this.list.appendChild(button)
        let position = -1
        try {
          const view = getEditorView()
          if (view) {
            const $pos = view.state.doc.resolve(view.posAtDOM(heading, 0))
            for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'heading') { position = $pos.before(depth); break }
          }
        } catch {}
        button.dataset.position = String(position)
        button.addEventListener('dragstart', (event) => {
          if (position < 0) return
          event.dataTransfer?.setData('application/x-colamd-heading', String(position))
          event.dataTransfer?.setData('text/plain', text)
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        })
        button.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('application/x-colamd-heading')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } })
        button.addEventListener('drop', (event) => {
          event.preventDefault()
          const source = Number(event.dataTransfer?.getData('application/x-colamd-heading'))
          if (Number.isFinite(source) && source >= 0 && source !== position && position >= 0) this.onMoveHeading?.(source, position)
        })
        this.entries.push({ element: heading, button, position })
      }
    }

    this.emptyState.hidden = this.entries.length > 0
    this.list.hidden = this.entries.length === 0
    this.updateActiveHeading()
  }

  private handleScroll = (): void => {
    if (this.scrollFrame !== null) return
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = null
      this.updateActiveHeading()
    })
  }

  private updateActiveHeading(): void {
    if (this.entries.length === 0) return
    if (this.editor.scrollTop + this.editor.clientHeight >= this.editor.scrollHeight - 4) {
      this.setActive(this.entries[this.entries.length - 1].button)
      return
    }

    const threshold = this.editor.getBoundingClientRect().top + 32
    let active = this.entries[0]
    for (const entry of this.entries) {
      if (entry.element.getBoundingClientRect().top > threshold) break
      active = entry
    }
    this.setActive(active.button)
  }

  private setActive(activeButton: HTMLButtonElement): void {
    for (const entry of this.entries) {
      const isActive = entry.button === activeButton
      entry.button.classList.toggle('active', isActive)
      if (isActive) entry.button.setAttribute('aria-current', 'location')
      else entry.button.removeAttribute('aria-current')
    }
  }
}

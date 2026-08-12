import { t } from '../i18n'

const MIN_SCALE = 0.25
const MAX_SCALE = 8

interface ImageDetails {
  src: string
  alt: string
}

export class ImageViewer {
  private overlay: HTMLDivElement | null = null
  private stage: HTMLDivElement | null = null
  private image: HTMLImageElement | null = null
  private closeButton: HTMLButtonElement | null = null
  private details: ImageDetails | null = null
  private previousFocusedElement: HTMLElement | null = null
  private scale = 1
  private panX = 0
  private panY = 0
  private dragging = false
  private dragStartX = 0
  private dragStartY = 0
  private dragPanX = 0
  private dragPanY = 0
  private suppressBackdropClose = false

  constructor() {
    window.addEventListener('colamd-language-changed', () => this.applyLanguage())
  }

  get isOpen(): boolean {
    return this.overlay !== null
  }

  open(details: ImageDetails): void {
    this.close()
    this.previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const overlay = document.createElement('div')
    overlay.className = 'image-viewer-overlay'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.tabIndex = -1

    const stage = document.createElement('div')
    stage.className = 'image-viewer-stage'
    const image = document.createElement('img')
    image.className = 'image-viewer-image'
    image.src = details.src
    image.alt = details.alt
    image.draggable = false

    const closeButton = document.createElement('button')
    closeButton.className = 'image-viewer-close'
    closeButton.type = 'button'
    closeButton.textContent = '\u00d7'

    stage.append(image)
    overlay.append(stage, closeButton)
    document.body.append(overlay)
    this.overlay = overlay
    this.stage = stage
    this.image = image
    this.closeButton = closeButton
    this.details = details
    this.applyLanguage()
    this.reset()

    closeButton.addEventListener('click', () => this.close())
    stage.addEventListener('click', (event) => {
      if (event.target === stage && !this.dragging && !this.suppressBackdropClose) this.close()
    })
    stage.addEventListener('dblclick', () => this.reset())
    overlay.addEventListener('wheel', this.handleWheel, { passive: false })
    overlay.addEventListener('keydown', this.handleKeydown)
    image.addEventListener('pointerdown', this.handlePointerDown)
    image.addEventListener('pointermove', this.handlePointerMove)
    image.addEventListener('pointerup', this.handlePointerUp)
    image.addEventListener('pointercancel', this.handlePointerUp)
    overlay.focus()
  }

  close(): void {
    if (!this.overlay) return
    const previousFocusedElement = this.previousFocusedElement
    this.overlay.removeEventListener('wheel', this.handleWheel)
    this.overlay.removeEventListener('keydown', this.handleKeydown)
    this.image?.removeEventListener('pointerdown', this.handlePointerDown)
    this.image?.removeEventListener('pointermove', this.handlePointerMove)
    this.image?.removeEventListener('pointerup', this.handlePointerUp)
    this.image?.removeEventListener('pointercancel', this.handlePointerUp)
    this.overlay.remove()
    this.overlay = null
    this.stage = null
    this.image = null
    this.closeButton = null
    this.details = null
    this.previousFocusedElement = null
    this.dragging = false
    this.suppressBackdropClose = false
    this.scale = 1
    this.panX = 0
    this.panY = 0
    if (this.isFocusable(previousFocusedElement)) previousFocusedElement.focus({ preventScroll: true })
  }

  private applyLanguage(): void {
    if (!this.overlay || !this.details) return
    const label = this.details.alt ? `${t('imagePreview')}: ${this.details.alt}` : t('imagePreview')
    this.overlay.setAttribute('aria-label', label)
    this.closeButton?.setAttribute('aria-label', t('closeImagePreview'))
  }

  private reset(): void {
    this.scale = 1
    this.panX = 0
    this.panY = 0
    this.applyTransform()
  }

  private applyTransform(): void {
    if (!this.image) return
    this.image.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`
    this.image.classList.toggle('is-zoomed', this.scale > 1.001)
  }

  private setScale(nextScale: number, clientX?: number, clientY?: number): void {
    if (!Number.isFinite(nextScale)) return
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    if (!this.stage || clientX === undefined || clientY === undefined) {
      this.scale = clamped
      this.applyTransform()
      return
    }

    const rect = this.stage.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = clientX - rect.left - rect.width / 2
    const y = clientY - rect.top - rect.height / 2
    const imageX = (x - this.panX) / this.scale
    const imageY = (y - this.panY) / this.scale
    this.panX = x - imageX * clamped
    this.panY = y - imageY * clamped
    this.scale = clamped
    this.applyTransform()
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    this.setScale(this.scale * factor, event.clientX, event.clientY)
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const focusable = this.getFocusableElements()
      if (focusable.length === 0) {
        this.overlay?.focus()
        return
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)
      focusable[nextIndex].focus()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      this.reset()
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      this.setScale(this.scale * 1.25)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      this.setScale(this.scale / 1.25)
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.image || this.scale <= 1.001 || event.button !== 0) return
    this.dragging = true
    this.dragStartX = event.clientX
    this.dragStartY = event.clientY
    this.dragPanX = this.panX
    this.dragPanY = this.panY
    this.image.setPointerCapture(event.pointerId)
    this.image.classList.add('is-dragging')
    event.preventDefault()
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return
    if (Math.abs(event.clientX - this.dragStartX) > 3 || Math.abs(event.clientY - this.dragStartY) > 3) {
      this.suppressBackdropClose = true
    }
    this.panX = this.dragPanX + event.clientX - this.dragStartX
    this.panY = this.dragPanY + event.clientY - this.dragStartY
    this.applyTransform()
  }

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.dragging || !this.image) return
    this.dragging = false
    if (this.image.hasPointerCapture(event.pointerId)) this.image.releasePointerCapture(event.pointerId)
    this.image.classList.remove('is-dragging')
    if (this.suppressBackdropClose) window.setTimeout(() => { this.suppressBackdropClose = false }, 0)
  }

  private getFocusableElements(): HTMLElement[] {
    if (!this.overlay) return []
    return Array.from(this.overlay.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
    )).filter((element) => this.isFocusable(element))
  }

  private isFocusable(element: HTMLElement | null): element is HTMLElement {
    return Boolean(element && element.isConnected && !element.matches(':disabled') && (element.tabIndex >= 0 || element.isContentEditable))
  }
}

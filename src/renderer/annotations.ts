import type { AnnotationComment, AnnotationSuggestion, AnnotationsData } from '../preload/index'

export type { AnnotationComment, AnnotationSuggestion, AnnotationsData }

interface DocumentAnnotations {
  data: AnnotationsData
  loaded: boolean
  saveTimer: ReturnType<typeof setTimeout> | null
}

const stores = new Map<string, DocumentAnnotations>()
const listeners = new Set<() => void>()

export function onAnnotationsChanged(listener: () => void): void {
  listeners.add(listener)
}

function emit(): void {
  for (const listener of listeners) listener()
}

function storeFor(documentId: string): DocumentAnnotations {
  let store = stores.get(documentId)
  if (!store) {
    store = { data: { version: 1, comments: [], suggestions: [] }, loaded: false, saveTimer: null }
    stores.set(documentId, store)
  }
  return store
}

/** 加载（或返回已缓存的）文档批注；首次调用后异步填充并触发变更事件。 */
export function ensureAnnotations(documentId: string): AnnotationsData {
  const store = storeFor(documentId)
  if (!store.loaded) {
    store.loaded = true
    void window.electronAPI.loadAnnotations(documentId)
      .then((data) => {
        store.data = {
          version: 1,
          comments: Array.isArray(data?.comments) ? data.comments : [],
          suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        }
        emit()
      })
      .catch(() => undefined)
  }
  return store.data
}

export function getAnnotations(documentId: string): AnnotationsData {
  return storeFor(documentId).data
}

function scheduleSave(documentId: string): void {
  const store = storeFor(documentId)
  if (store.saveTimer) clearTimeout(store.saveTimer)
  store.saveTimer = setTimeout(() => {
    store.saveTimer = null
    void window.electronAPI.saveAnnotations(documentId, store.data)
  }, 500)
}

/** 立即落盘（切换/关闭标签前调用）。 */
export function flushAnnotations(documentId: string): void {
  const store = stores.get(documentId)
  if (!store) return
  if (store.saveTimer) {
    clearTimeout(store.saveTimer)
    store.saveTimer = null
  }
  void window.electronAPI.saveAnnotations(documentId, store.data)
}

function mutate(documentId: string, change: (data: AnnotationsData) => void): void {
  const store = storeFor(documentId)
  change(store.data)
  scheduleSave(documentId)
  emit()
}

export function addComment(documentId: string, comment: AnnotationComment): void {
  mutate(documentId, (data) => { data.comments = [comment, ...data.comments] })
}

export function setCommentResolved(documentId: string, id: string, resolved: boolean): void {
  mutate(documentId, (data) => {
    const target = data.comments.find((comment) => comment.id === id)
    if (target) target.resolved = resolved
  })
}

export function deleteComment(documentId: string, id: string): void {
  mutate(documentId, (data) => { data.comments = data.comments.filter((comment) => comment.id !== id) })
}

export function addSuggestions(documentId: string, suggestions: AnnotationSuggestion[]): void {
  if (!suggestions.length) return
  mutate(documentId, (data) => { data.suggestions = [...suggestions, ...data.suggestions] })
}

export function setSuggestionStatus(documentId: string, id: string, status: AnnotationSuggestion['status']): void {
  mutate(documentId, (data) => {
    const target = data.suggestions.find((suggestion) => suggestion.id === id)
    if (target) target.status = status
  })
}

export function makeAnnotationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 提取锚点上下文，用于编辑后重新定位。 */
export function contextAround(text: string, from: number, to: number, radius = 48): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, from - radius), from),
    suffix: text.slice(to, Math.min(text.length, to + radius)),
  }
}

/** 按锚文本 + 前后上下文在正文中重新定位，取匹配度最高的一处。 */
export function locateAnchor(text: string, anchor: string, prefix: string, suffix: string): { from: number; to: number } | null {
  if (!anchor) return null
  let best: { from: number; score: number } | null = null
  let index = text.indexOf(anchor)
  while (index !== -1) {
    let score = 1
    if (prefix && text.slice(Math.max(0, index - prefix.length), index) === prefix) score += 2
    if (suffix && text.slice(index + anchor.length, index + anchor.length + suffix.length) === suffix) score += 2
    if (!best || score > best.score) best = { from: index, score }
    index = text.indexOf(anchor, index + 1)
  }
  return best ? { from: best.from, to: best.from + anchor.length } : null
}

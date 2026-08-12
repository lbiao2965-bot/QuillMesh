import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import { isRelativeImageSource, resolveLocalImageSource } from './local-image'

export const imageView = $view(imageSchema.node, (): NodeViewConstructor => {
  return (initialNode) => {
    const dom = document.createElement('img')
    let currentNode = initialNode
    let renderVersion = 0
    let destroyed = false

    const render = (node: ProseMirrorNode): void => {
      currentNode = node
      const version = ++renderVersion
      const source = String(node.attrs.src ?? '')
      dom.dataset.colamdSource = source
      dom.alt = String(node.attrs.alt ?? '')

      const title = String(node.attrs.title ?? '')
      if (title) dom.title = title
      else dom.removeAttribute('title')

      if (!isRelativeImageSource(source)) {
        dom.src = source
        return
      }

      // Keep the document's relative source in the ProseMirror node. Only the
      // DOM preview receives a data URL, so saving never embeds image bytes.
      dom.removeAttribute('src')
      void resolveLocalImageSource(source).then((resolved) => {
        if (destroyed || version !== renderVersion || currentNode !== node) return
        if (resolved) dom.src = resolved
        else dom.src = source
      })
    }

    render(initialNode)
    return {
      dom,
      update: (updatedNode) => {
        if (updatedNode.type !== initialNode.type) return false
        render(updatedNode)
        return true
      },
      ignoreMutation: () => true,
      destroy: () => {
        destroyed = true
        renderVersion += 1
      },
    }
  }
})

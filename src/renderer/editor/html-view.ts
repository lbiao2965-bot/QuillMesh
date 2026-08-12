import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { isRelativeImageSource, resolveLocalImageSource } from './local-image'

export const htmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (initialNode) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-html-inline')
    let renderVersion = 0
    let destroyed = false

    const render = (node: ProseMirrorNode): void => {
      const version = ++renderVersion
      const value = node.attrs.value as string
      dom.dataset.value = value
      dom.innerHTML = value

      dom.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
        const source = image.getAttribute('src') ?? ''
        image.dataset.colamdSource = source
        if (!isRelativeImageSource(source)) return

        image.removeAttribute('src')
        void resolveLocalImageSource(source).then((resolved) => {
          if (destroyed || version !== renderVersion || !dom.contains(image)) return
          image.src = resolved ?? source
        })
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
      stopEvent: () => true,
      ignoreMutation: () => true,
      destroy: () => {
        destroyed = true
        renderVersion += 1
      },
    }
  }
})

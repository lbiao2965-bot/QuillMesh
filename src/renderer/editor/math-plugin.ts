import { Fragment } from '@milkdown/kit/prose/model'
import { nodeRule } from '@milkdown/kit/prose'
import { $ctx, $inputRule, $nodeSchema, $remark } from '@milkdown/kit/utils'
import type { KatexOptions } from 'katex'
import katex from 'katex'
import remarkMath from 'remark-math'

export const remarkMathPlugin = $remark('remarkMath', () => remarkMath)

export const katexOptionsCtx = $ctx<KatexOptions, 'katexOptions'>({}, 'katexOptions')

export const mathInlineSchema = $nodeSchema('math_inline', (ctx) => ({
  group: 'inline',
  content: 'text*',
  inline: true,
  atom: true,
  parseDOM: [{
    tag: 'span[data-type="math_inline"]',
    getContent: (dom, schema) => {
      if (!(dom instanceof HTMLElement)) return Fragment.empty
      return Fragment.from(schema.text(dom.dataset.value ?? ''))
    },
  }],
  toDOM: (node) => {
    const code = node.textContent
    const dom = document.createElement('span')
    dom.dataset.type = 'math_inline'
    dom.dataset.value = code
    katex.render(code, dom, ctx.get(katexOptionsCtx.key))
    return dom
  },
  parseMarkdown: {
    match: ({ type }) => type === 'inlineMath',
    runner: (state, node, type) => state.openNode(type).addText(String(node.value ?? '')).closeNode(),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => state.addNode('inlineMath', undefined, node.textContent),
  },
}))

export const mathInlineInputRule = $inputRule((ctx) =>
  nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
    beforeDispatch: ({ tr, match, start }) => {
      tr.insertText(match[1] ?? '', start + 1)
    },
  })
)

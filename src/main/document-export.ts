import { BrowserWindow } from 'electron'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

interface WordRunModel {
  text?: string
  bold?: boolean
  italics?: boolean
  underline?: boolean
  code?: boolean
  break?: number
  link?: string
  image?: { src: string; width: number; height: number; alt: string }
  math?: WordMathModel
}

interface WordMathModel {
  id: string
  latex: string
  width: number
  height: number
  display: boolean
  image?: { data: string; width: number; height: number }
}

type WordBlockModel =
  | { type: 'paragraph'; runs: WordRunModel[]; heading?: number; quote?: boolean; alignment?: string }
  | { type: 'code'; text: string }
  | { type: 'list'; runs: WordRunModel[]; ordered: boolean; level: number }
  | { type: 'table'; rows: Array<Array<WordRunModel[]>> }
  | { type: 'math'; math: WordMathModel; number?: number }
  | { type: 'rule' }

const WORD_MODEL_SCRIPT = `(() => {
  let mathSequence = 0
  let equationSequence = 0
  const showEquationNumbers = document.body.classList.contains('show-equation-numbers')

  const registerMath = (element, latex, display) => {
    const target = element.matches('.katex') ? element : element.querySelector('.katex') || element
    const id = 'colamd-word-math-' + (++mathSequence)
    target.setAttribute('data-word-math-id', id)
    const rect = target.getBoundingClientRect()
    return {
      id,
      latex: latex || element.getAttribute('data-value') || element.textContent || '',
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
      display,
    }
  }

  const mathLatex = (element) =>
    element.getAttribute('data-value') ||
    element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
    ''

  const inline = (nodes, inherited = {}) => {
    const runs = []
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) runs.push({ text: node.textContent, ...inherited })
        continue
      }
      if (!(node instanceof HTMLElement)) continue
      if (node.matches('[data-type="math_inline"], .math-inline, .katex')) {
        runs.push({ math: registerMath(node, mathLatex(node), false), ...inherited })
        continue
      }
      if (node.tagName === 'BR') {
        runs.push({ text: '', break: 1, ...inherited })
        continue
      }
      if (node instanceof HTMLImageElement) {
        const rect = node.getBoundingClientRect()
        const naturalWidth = node.naturalWidth || rect.width || 320
        const naturalHeight = node.naturalHeight || rect.height || 180
        const width = Math.max(1, Math.min(620, Math.round(rect.width || naturalWidth)))
        const height = Math.max(1, Math.round(width * naturalHeight / naturalWidth))
        runs.push({ image: { src: node.src, width, height, alt: node.alt || '' }, ...inherited })
        continue
      }
      const tag = node.tagName
      const style = {
        ...inherited,
        bold: inherited.bold || tag === 'STRONG' || tag === 'B',
        italics: inherited.italics || tag === 'EM' || tag === 'I',
        underline: inherited.underline || tag === 'U',
        code: inherited.code || tag === 'CODE',
        link: tag === 'A' ? node.getAttribute('href') || undefined : inherited.link,
      }
      runs.push(...inline(node.childNodes, style))
    }
    return runs
  }

  const blocks = []
  const visit = (element, context = {}) => {
    const tag = element.tagName
    if (element.matches('[data-type="math_block"], .math-block')) {
      blocks.push({
        type: 'math',
        math: registerMath(element, mathLatex(element), true),
        number: showEquationNumbers ? ++equationSequence : undefined,
      })
      return
    }
    if (/^H[1-6]$/.test(tag)) {
      blocks.push({ type: 'paragraph', heading: Number(tag.slice(1)), runs: inline(element.childNodes), quote: context.quote })
      return
    }
    if (tag === 'P') {
      const alignment = getComputedStyle(element).textAlign
      blocks.push({ type: 'paragraph', runs: inline(element.childNodes), quote: context.quote, alignment })
      return
    }
    if (tag === 'PRE') {
      blocks.push({ type: 'code', text: element.textContent || '' })
      return
    }
    if (tag === 'BLOCKQUOTE') {
      const children = Array.from(element.children)
      if (children.length) children.forEach((child) => visit(child, { ...context, quote: true }))
      else blocks.push({ type: 'paragraph', runs: inline(element.childNodes), quote: true })
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      const ordered = tag === 'OL'
      const level = context.level || 0
      for (const item of Array.from(element.children).filter((child) => child.tagName === 'LI')) {
        const contentNodes = Array.from(item.childNodes).filter((child) => !(child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')))
        blocks.push({ type: 'list', runs: inline(contentNodes), ordered, level })
        for (const nested of Array.from(item.children).filter((child) => child.tagName === 'UL' || child.tagName === 'OL')) {
          visit(nested, { ...context, level: level + 1 })
        }
      }
      return
    }
    if (tag === 'TABLE') {
      const rows = Array.from(element.querySelectorAll('tr')).map((row) =>
        Array.from(row.children).filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD').map((cell) => inline(cell.childNodes))
      )
      blocks.push({ type: 'table', rows })
      return
    }
    if (tag === 'HR') {
      blocks.push({ type: 'rule' })
      return
    }
    if (element.children.length) Array.from(element.children).forEach((child) => visit(child, context))
    else if (element.textContent?.trim()) blocks.push({ type: 'paragraph', runs: inline(element.childNodes), quote: context.quote })
  }

  const root = document.querySelector('#editor .ProseMirror')
  if (!root) return []
  Array.from(root.children).forEach((child) => visit(child))
  return blocks
})()`

function collectMathModels(blocks: WordBlockModel[]): WordMathModel[] {
  const models: WordMathModel[] = []
  const collectRuns = (runs: WordRunModel[]): void => {
    for (const run of runs) if (run.math) models.push(run.math)
  }

  for (const block of blocks) {
    if (block.type === 'math') models.push(block.math)
    else if (block.type === 'paragraph' || block.type === 'list') collectRuns(block.runs)
    else if (block.type === 'table') {
      for (const row of block.rows) for (const cell of row) collectRuns(cell)
    }
  }
  return models
}

async function captureWordMath(win: BrowserWindow, blocks: WordBlockModel[]): Promise<void> {
  const models = collectMathModels(blocks)
  if (!models.length) return

  await win.webContents.executeJavaScript(`(() => {
    const style = document.createElement('style')
    style.textContent = \`
      [data-word-math-id] {
        padding: 3px 5px !important;
        border-radius: 0 !important;
        background: #fff !important;
        color: #111 !important;
      }
      [data-word-math-id] * { color: #111 !important; }
    \`
    document.head.appendChild(style)
  })()`)

  const dimensions = await win.webContents.executeJavaScript(`({
    width: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
    height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  })`) as { width: number; height: number }
  if (dimensions.height > 30000) return

  const pageWidth = Math.max(1, Math.min(1600, dimensions.width))
  const pageHeight = Math.max(1, dimensions.height)
  win.setContentSize(pageWidth, pageHeight)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const ids = JSON.stringify(models.map((model) => model.id))
  const layout = await win.webContents.executeJavaScript(`(() => {
    const result = {}
    for (const id of ${ids}) {
      const element = document.querySelector('[data-word-math-id="' + id + '"]')
      if (!element) continue
      const box = element.getBoundingClientRect()
      result[id] = {
        x: Math.max(0, Math.floor(box.x + window.scrollX)),
        y: Math.max(0, Math.floor(box.y + window.scrollY)),
        width: Math.max(1, Math.ceil(box.width)),
        height: Math.max(1, Math.ceil(box.height))
      }
    }
    return result
  })()`) as Record<string, { x: number; y: number; width: number; height: number }>
  const pageImage = await win.webContents.capturePage({ x: 0, y: 0, width: pageWidth, height: pageHeight })

  for (const model of models) {
    const rect = layout[model.id]
    if (!rect || rect.x >= pageWidth || rect.y >= pageHeight) continue
    const crop = {
      x: rect.x,
      y: rect.y,
      width: Math.max(1, Math.min(rect.width, pageWidth - rect.x)),
      height: Math.max(1, Math.min(rect.height, pageHeight - rect.y)),
    }
    const image = pageImage.crop(crop)
    const preferredWidth = model.display ? Math.min(560, model.width) : Math.min(300, model.width)
    const preferredHeight = Math.max(1, Math.round(preferredWidth * crop.height / crop.width))
    model.image = {
      data: image.toPNG().toString('base64'),
      width: preferredWidth,
      height: preferredHeight,
    }
  }
}

async function waitForPageAssets(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`
    Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images).map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
            setTimeout(resolve, 5000)
          }))
    ])
  `)
}

async function withExportWindow<T>(html: string, operation: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'colamd-export-'))
  const tempHtml = join(tempDirectory, 'document.html')
  let exportWindow: BrowserWindow | null = null

  try {
    await writeFile(tempHtml, html, 'utf-8')
    exportWindow = new BrowserWindow({
      show: false,
      width: 1120,
      height: 800,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    await exportWindow.loadFile(tempHtml)
    await waitForPageAssets(exportWindow)
    return await operation(exportWindow)
  } finally {
    if (exportWindow && !exportWindow.isDestroyed()) exportWindow.destroy()
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

export async function renderPdf(html: string): Promise<Buffer> {
  return withExportWindow(html, (win) => win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  }))
}

export async function renderPng(html: string): Promise<Buffer> {
  return withExportWindow(html, async (win) => {
    const dimensions = await win.webContents.executeJavaScript(`({
      width: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
      height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
    })`) as { width: number; height: number }

    const width = Math.max(1, Math.min(1600, dimensions.width))
    if (dimensions.height > 30000) {
      throw new Error('The document is too tall for a single PNG image.')
    }
    const height = Math.max(1, dimensions.height)
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    return image.toPNG()
  })
}

function headingLevel(level: number | undefined): typeof HeadingLevel[keyof typeof HeadingLevel] | undefined {
  const levels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]
  return level ? levels[level - 1] : undefined
}

function imageRun(model: NonNullable<WordRunModel['image']>): ImageRun | TextRun {
  const match = model.src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,([a-z\d+/=]+)$/i)
  if (!match) return new TextRun({ text: model.alt || '[Image]', italics: true, color: '777777' })

  const type = match[1].toLowerCase().replace('jpeg', 'jpg') as 'png' | 'jpg' | 'gif' | 'bmp'
  return new ImageRun({
    type,
    data: Buffer.from(match[2], 'base64'),
    transformation: { width: model.width, height: model.height },
  })
}

function mathRun(model: WordMathModel): ImageRun | TextRun {
  if (!model.image) {
    return new TextRun({ text: model.latex, font: 'Cambria Math', italics: true })
  }
  return new ImageRun({
    type: 'png',
    data: Buffer.from(model.image.data, 'base64'),
    transformation: { width: model.image.width, height: model.image.height },
  })
}

function wordRuns(models: WordRunModel[]): Array<TextRun | ImageRun | ExternalHyperlink> {
  return models.map((model) => {
    if (model.image) return imageRun(model.image)
    if (model.math) return mathRun(model.math)
    const textRun = new TextRun({
      text: model.text ?? '',
      bold: model.bold,
      italics: model.italics,
      underline: model.underline || model.link ? { type: UnderlineType.SINGLE } : undefined,
      break: model.break,
      font: model.code ? 'Consolas' : undefined,
      color: model.link ? '0563C1' : undefined,
    })
    if (model.link && /^(https?:|mailto:)/i.test(model.link)) {
      return new ExternalHyperlink({ children: [textRun], link: model.link })
    }
    return textRun
  })
}

function paragraphAlignment(value: string | undefined): typeof AlignmentType[keyof typeof AlignmentType] | undefined {
  if (value === 'center') return AlignmentType.CENTER
  if (value === 'right') return AlignmentType.RIGHT
  if (value === 'justify') return AlignmentType.JUSTIFIED
  return undefined
}

function buildWordChildren(blocks: WordBlockModel[]): Array<Paragraph | Table> {
  return blocks.map((block) => {
    if (block.type === 'table') {
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map((row) => new TableRow({
          children: row.map((cell) => new TableCell({
            children: [new Paragraph({ children: wordRuns(cell) })],
          })),
        })),
      })
    }
    if (block.type === 'rule') {
      return new Paragraph({
        border: { bottom: { color: 'BFBFBF', style: BorderStyle.SINGLE, size: 6, space: 1 } },
      })
    }
    if (block.type === 'math') {
      if (block.number === undefined) {
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [mathRun(block.math)],
          spacing: { before: 160, after: 160 },
        })
      }
      return new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: 4870 },
          { type: TabStopType.RIGHT, position: 9680 },
        ],
        children: [
          new TextRun('\t'),
          mathRun(block.math),
          new TextRun({ text: `\t(${block.number})`, font: 'Cambria Math' }),
        ],
        spacing: { before: 160, after: 160 },
      })
    }
    if (block.type === 'code') {
      return new Paragraph({
        children: [new TextRun({ text: block.text, font: 'Consolas', size: 19 })],
        shading: { fill: 'F2F2F2' },
        spacing: { before: 160, after: 160 },
        indent: { left: 240, right: 240 },
      })
    }
    if (block.type === 'list') {
      return new Paragraph({
        children: wordRuns(block.runs),
        ...(block.ordered
          ? { numbering: { reference: 'colamd-numbering', level: Math.min(block.level, 5) } }
          : { bullet: { level: Math.min(block.level, 5) } }),
      })
    }
    return new Paragraph({
      children: wordRuns(block.runs),
      heading: headingLevel(block.heading),
      alignment: paragraphAlignment(block.alignment),
      indent: block.quote ? { left: 420 } : undefined,
      border: block.quote ? { left: { color: 'C44B2B', style: BorderStyle.SINGLE, size: 12, space: 8 } } : undefined,
      spacing: { after: 120 },
    })
  })
}

export async function renderDocx(html: string, title: string, language: string): Promise<Buffer> {
  return withExportWindow(html, async (win) => {
    const blocks = await win.webContents.executeJavaScript(WORD_MODEL_SCRIPT) as WordBlockModel[]
    await captureWordMath(win, blocks)
    const font = language.toLowerCase().startsWith('zh') ? 'Microsoft YaHei' : 'Arial'
    const document = new Document({
      title,
      creator: 'QuillMesh',
      lastModifiedBy: 'QuillMesh',
      styles: {
        default: {
          document: {
            run: { font, size: 22 },
            paragraph: { spacing: { line: 360 } },
          },
        },
      },
      numbering: {
        config: [{
          reference: 'colamd-numbering',
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 260 } } },
          })),
        }],
      },
      sections: [{
        properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children: buildWordChildren(blocks),
      }],
    })
    return Packer.toBuffer(document)
  })
}

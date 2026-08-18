import { readFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

export interface BibliographyFilePayload {
  path: string
  content: string
}

export type BibliographyBindingSource = 'manual' | 'sibling'

export interface BibliographyBinding {
  path: string
  source: BibliographyBindingSource
}

/**
 * Bibliography paths are capabilities bound to one document session. The
 * renderer never supplies a filesystem destination when appending BibTeX.
 */
export class BibliographyBindings {
  private readonly bindings = new Map<string, BibliographyBinding>()

  set(documentId: string, path: string, source: BibliographyBindingSource): void {
    this.bindings.set(documentId, { path, source })
  }

  get(documentId: string): BibliographyBinding | null {
    return this.bindings.get(documentId) ?? null
  }

  delete(documentId: string): void {
    this.bindings.delete(documentId)
  }
}

const BIBLIOGRAPHY_EXTENSIONS = ['.bib', '.biblatex', '.json']

/**
 * 在文档同目录查找同名的参考文献文件（paper.md → paper.bib 等），
 * 这样打开论文 Markdown 时可以无感自动加载引用库。
 */
export async function findSiblingBibliography(documentPath: string | null): Promise<string | null> {
  if (!documentPath) return null
  const base = basename(documentPath).replace(/\.[^.]+$/, '')
  if (!base) return null
  const directory = dirname(documentPath)
  for (const extension of BIBLIOGRAPHY_EXTENSIONS) {
    const candidate = join(directory, `${base}${extension}`)
    try {
      await readFile(candidate)
      return candidate
    } catch {
      // Try the next extension.
    }
  }
  return null
}

export async function readBibliographyFile(path: string): Promise<BibliographyFilePayload | null> {
  try {
    const content = await readFile(path, 'utf-8')
    return { path, content }
  } catch {
    return null
  }
}

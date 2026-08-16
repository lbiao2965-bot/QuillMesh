import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

/**
 * 批注与审阅数据存放在文档同目录的 .quillmesh/ 辅助文件中，
 * 不污染 Markdown 正文。每个文档一个 <文件名>.annotations.json。
 */
export interface AnnotationsFileData {
  version: 1
  comments: unknown[]
  suggestions: unknown[]
}

function annotationsPath(documentPath: string): string {
  return join(dirname(documentPath), '.quillmesh', `${basename(documentPath)}.annotations.json`)
}

export async function loadAnnotations(documentPath: string | null): Promise<AnnotationsFileData> {
  const empty: AnnotationsFileData = { version: 1, comments: [], suggestions: [] }
  if (!documentPath) return empty
  try {
    const raw = await readFile(annotationsPath(documentPath), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AnnotationsFileData> | null
    return {
      version: 1,
      comments: Array.isArray(parsed?.comments) ? parsed.comments : [],
      suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
    }
  } catch {
    return empty
  }
}

export async function saveAnnotations(documentPath: string | null, data: AnnotationsFileData): Promise<boolean> {
  if (!documentPath) return false
  const target = annotationsPath(documentPath)
  const payload: AnnotationsFileData = {
    version: 1,
    comments: Array.isArray(data?.comments) ? data.comments : [],
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
  }
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  await rename(temporary, target)
  return true
}

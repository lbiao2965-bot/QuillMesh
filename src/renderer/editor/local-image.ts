const RELATIVE_IMAGE_SOURCE = /^(?![a-zA-Z][a-zA-Z\d+.-]*:)(?!\/\/)(?![\\/])(?!#).+/

export function isRelativeImageSource(source: string): boolean {
  return RELATIVE_IMAGE_SOURCE.test(source.trim())
}

export async function resolveLocalImageSource(source: string): Promise<string | null> {
  const trimmed = source.trim()
  if (!isRelativeImageSource(trimmed)) return null

  try {
    return await window.electronAPI.loadLocalImage(trimmed)
  } catch {
    return null
  }
}

export type SplitMode = 'wysiwyg' | 'source' | 'split'

/**
 * In split mode the textarea is the serialized authority: source input updates
 * it immediately, and WYSIWYG changes mirror back to it. This avoids a stale
 * ProseMirror render overwriting newer rapid source input during tab switches.
 */
export function authoritativeContent(mode: SplitMode, sourceContent: string, wysiwygContent: string): string {
  return mode === 'wysiwyg' ? wysiwygContent : sourceContent
}

export function mirrorWysiwygToSource(sourceContent: string, wysiwygContent: string): string {
  return sourceContent === wysiwygContent ? sourceContent : wysiwygContent
}

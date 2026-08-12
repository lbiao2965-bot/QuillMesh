/**
 * Pure save-version decisions shared by renderer persistence and its
 * deterministic regression. A successful write only cleans the exact buffer
 * snapshot that was sent to the main process.
 */
export function remainsDirtyAfterSave(
  currentEditVersion: number,
  savedEditVersion: number,
  currentContent: string,
  savedContent: string,
): boolean {
  return currentEditVersion !== savedEditVersion || currentContent !== savedContent
}

export function nextEditVersion(previous: number, previousContent: string, nextContent: string): number {
  return previousContent === nextContent ? previous : previous + 1
}

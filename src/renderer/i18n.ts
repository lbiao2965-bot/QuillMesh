import { normalizeLanguage, translate, type AppLanguage, type TranslationKey } from '../shared/i18n'

let currentLanguage: AppLanguage = 'en'

export function getRendererLanguage(): AppLanguage {
  return currentLanguage
}

export function t(key: TranslationKey): string {
  return translate(currentLanguage, key)
}

export function setRendererLanguage(language: unknown): AppLanguage {
  currentLanguage = normalizeLanguage(language) ?? 'en'
  document.documentElement.lang = currentLanguage
  applyStaticTranslations()
  window.dispatchEvent(new CustomEvent('colamd-language-changed'))
  return currentLanguage
}

function applyStaticTranslations(): void {
  const filesTab = document.getElementById('files-tab')
  if (filesTab) filesTab.textContent = t('files')

  const outlineTab = document.getElementById('outline-tab')
  if (outlineTab) outlineTab.textContent = t('outline')

  const outlineList = document.getElementById('outline-list')
  if (outlineList) outlineList.setAttribute('aria-label', t('outline'))

  const outlineEmpty = document.getElementById('outline-empty')
  if (outlineEmpty) outlineEmpty.textContent = t('noHeadings')

  const fileToggle = document.getElementById('file-toggle-btn')
  if (fileToggle) fileToggle.title = `${t('toggleFileList')} (Ctrl/Cmd+Shift+B)`

}

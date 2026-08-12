declare module 'katex/dist/katex.min.css?inline' {
  const css: string
  export default css
}

interface Window {
  electronAPI: import('../preload/index').ElectronAPI
}

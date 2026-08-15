// 公式输入助手的符号与模板数据。
// glyph: 渲染失败时的回退字符；latex: 插入文本；| 表示插入后光标位置；
// 有选区时优先填充到 {|} 所在的组。
// demo: 可选，悬停预览的 KaTeX 渲染串（latex 无法独立渲染时必须提供）。
// compact: 可选，按钮上的紧凑渲染串（大模板防止撑爆按钮）。

export interface SymbolItem {
  glyph: string
  latex: string
  title?: string
  demo?: string
  compact?: string
}

export function snippetCursorIndex(snippet: string): number {
  const groupedMarker = snippet.indexOf('{|}')
  if (groupedMarker >= 0) return groupedMarker + 1
  const optionalMarker = snippet.indexOf('[|]')
  if (optionalMarker >= 0) return optionalMarker + 1
  const spacedMarker = snippet.match(/(?:^|\s)\|(?!\|)(?=\s|&|=|$)/)
  if (spacedMarker?.index !== undefined) return spacedMarker.index + spacedMarker[0].lastIndexOf('|')
  return -1
}

export function withoutSnippetCursor(snippet: string): string {
  const index = snippetCursorIndex(snippet)
  return index < 0 ? snippet : snippet.slice(0, index) + snippet.slice(index + 1)
}

export const symbolTabs = ['common', 'greek', 'sets', 'calculus', 'templates', 'favorites', 'recent'] as const
export type SymbolTab = (typeof symbolTabs)[number]

export const symbolData: Record<Exclude<SymbolTab, 'favorites' | 'recent'>, SymbolItem[]> = {
  common: [
    { glyph: '±', latex: '\\pm ' },
    { glyph: '×', latex: '\\times ' },
    { glyph: '÷', latex: '\\div ' },
    { glyph: '≠', latex: '\\neq ' },
    { glyph: '≈', latex: '\\approx ' },
    { glyph: '≡', latex: '\\equiv ' },
    { glyph: '≤', latex: '\\leq ' },
    { glyph: '≥', latex: '\\geq ' },
    { glyph: '≪', latex: '\\ll ' },
    { glyph: '≫', latex: '\\gg ' },
    { glyph: '∞', latex: '\\infty ' },
    { glyph: '°', latex: '^{\\circ}' },
    { glyph: '·', latex: '\\cdot ' },
    { glyph: '…', latex: '\\ldots ' },
    { glyph: '∝', latex: '\\propto ' },
    { glyph: '∠', latex: '\\angle ' },
    { glyph: '⊥', latex: '\\perp ' },
    { glyph: '∥', latex: '\\parallel ' },
    { glyph: 'π', latex: '\\pi ' },
    { glyph: 'e', latex: 'e' },
    { glyph: '|x|', latex: '|{|}|' },
    { glyph: '‖x‖', latex: '\\|{|}\\|' },
    { glyph: '⟨x⟩', latex: '\\langle {|}\\rangle' },
    { glyph: '⌊x⌋', latex: '\\lfloor {|}\\rfloor' },
  ],
  greek: [
    { glyph: 'α', latex: '\\alpha ' }, { glyph: 'β', latex: '\\beta ' },
    { glyph: 'γ', latex: '\\gamma ' }, { glyph: 'δ', latex: '\\delta ' },
    { glyph: 'ε', latex: '\\epsilon ' }, { glyph: 'ζ', latex: '\\zeta ' },
    { glyph: 'η', latex: '\\eta ' }, { glyph: 'θ', latex: '\\theta ' },
    { glyph: 'ι', latex: '\\iota ' }, { glyph: 'κ', latex: '\\kappa ' },
    { glyph: 'λ', latex: '\\lambda ' }, { glyph: 'μ', latex: '\\mu ' },
    { glyph: 'ν', latex: '\\nu ' }, { glyph: 'ξ', latex: '\\xi ' },
    { glyph: 'π', latex: '\\pi ' }, { glyph: 'ρ', latex: '\\rho ' },
    { glyph: 'σ', latex: '\\sigma ' }, { glyph: 'τ', latex: '\\tau ' },
    { glyph: 'υ', latex: '\\upsilon ' }, { glyph: 'φ', latex: '\\phi ' },
    { glyph: 'χ', latex: '\\chi ' }, { glyph: 'ψ', latex: '\\psi ' },
    { glyph: 'ω', latex: '\\omega ' }, { glyph: 'Γ', latex: '\\Gamma ' },
    { glyph: 'Δ', latex: '\\Delta ' }, { glyph: 'Θ', latex: '\\Theta ' },
    { glyph: 'Λ', latex: '\\Lambda ' }, { glyph: 'Ξ', latex: '\\Xi ' },
    { glyph: 'Π', latex: '\\Pi ' }, { glyph: 'Σ', latex: '\\Sigma ' },
    { glyph: 'Φ', latex: '\\Phi ' }, { glyph: 'Ψ', latex: '\\Psi ' },
    { glyph: 'Ω', latex: '\\Omega ' },
  ],
  sets: [
    { glyph: '∈', latex: '\\in ' }, { glyph: '∉', latex: '\\notin ' },
    { glyph: '⊂', latex: '\\subset ' }, { glyph: '⊆', latex: '\\subseteq ' },
    { glyph: '⊃', latex: '\\supset ' }, { glyph: '⊇', latex: '\\supseteq ' },
    { glyph: '∪', latex: '\\cup ' }, { glyph: '∩', latex: '\\cap ' },
    { glyph: '∅', latex: '\\emptyset ' }, { glyph: '∀', latex: '\\forall ' },
    { glyph: '∃', latex: '\\exists ' }, { glyph: '¬', latex: '\\neg ' },
    { glyph: '∧', latex: '\\land ' }, { glyph: '∨', latex: '\\lor ' },
    { glyph: '⇒', latex: '\\Rightarrow ' }, { glyph: '⇔', latex: '\\Leftrightarrow ' },
    { glyph: '→', latex: '\\to ' }, { glyph: '↦', latex: '\\mapsto ' },
    { glyph: 'ℕ', latex: '\\mathbb{N} ' }, { glyph: 'ℤ', latex: '\\mathbb{Z} ' },
    { glyph: 'ℚ', latex: '\\mathbb{Q} ' }, { glyph: 'ℝ', latex: '\\mathbb{R} ' },
    { glyph: 'ℂ', latex: '\\mathbb{C} ' }, { glyph: '∖', latex: '\\setminus ' },
  ],
  calculus: [
    { glyph: '∫', latex: '\\int ' },
    { glyph: '∫ₐᵇ', latex: '\\int_{|}^{}' },
    { glyph: '∬', latex: '\\iint ' },
    { glyph: '∮', latex: '\\oint ' },
    { glyph: '∑', latex: '\\sum ' },
    { glyph: '∑ᵢⁿ', latex: '\\sum_{i=1}^{n} {|}' },
    { glyph: '∏', latex: '\\prod ' },
    { glyph: 'lim', latex: '\\lim_{|}' },
    { glyph: 'lim∞', latex: '\\lim_{x \\to \\infty} {|}' },
    { glyph: 'd/dx', latex: '\\frac{d}{dx} {|}' },
    { glyph: 'dy/dx', latex: '\\frac{dy}{dx}' },
    { glyph: '∂', latex: '\\partial ' },
    { glyph: '∂/∂x', latex: '\\frac{\\partial}{\\partial x} {|}' },
    { glyph: '∇', latex: '\\nabla ' },
    { glyph: 'dx', latex: '\\, dx' },
    { glyph: '′', latex: "'" },
    { glyph: '″', latex: "''" },
  ],
  templates: [
    { glyph: 'a/b', latex: '\\frac{|}{}', title: 'fraction', demo: '\\frac{a}{b}' },
    { glyph: '√', latex: '\\sqrt{|}', title: 'sqrt', demo: '\\sqrt{x}' },
    { glyph: 'ⁿ√', latex: '\\sqrt[|]{}', title: 'nth root', demo: '\\sqrt[n]{x}' },
    { glyph: 'x²', latex: '^{|}', title: 'superscript', demo: 'x^{2}' },
    { glyph: 'xᵢ', latex: '_{|}', title: 'subscript', demo: 'x_{i}' },
    { glyph: 'x²ᵢ', latex: '_{|}^{}', title: 'sub+sup', demo: 'x_{i}^{2}' },
    { glyph: 'x⃗', latex: '\\vec{|}', title: 'vector', demo: '\\vec{v}' },
    { glyph: 'x̂', latex: '\\hat{|}', title: 'hat', demo: '\\hat{x}' },
    { glyph: 'x̄', latex: '\\bar{|}', title: 'bar', demo: '\\bar{x}' },
    { glyph: 'ẋ', latex: '\\dot{|}', title: 'dot', demo: '\\dot{x}' },
    { glyph: 'x̲', latex: '\\underline{|}', title: 'underline', demo: '\\underline{x}' },
    { glyph: 'x̅', latex: '\\overline{|}', title: 'overline', demo: '\\overline{x}' },
    { glyph: '(ₙᵏ)', latex: '\\binom{|}{}', title: 'binomial', demo: '\\binom{n}{k}' },
    { glyph: '()', latex: '\\left( {|}\\right)', title: 'parentheses', demo: '\\left( x \\right)' },
    { glyph: '[]', latex: '\\left[ {|}\\right]', title: 'brackets', demo: '\\left[ x \\right]' },
    { glyph: '{}', latex: '\\left\\{ {|}\\right\\}', title: 'braces', demo: '\\left\\{ x \\right\\}' },
    {
      glyph: '2×2', title: 'matrix 2x2',
      latex: '\\begin{pmatrix} | &  \\\\  &  \\end{pmatrix}',
      demo: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      compact: '\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}',
    },
    {
      glyph: '3×3', title: 'matrix 3x3',
      latex: '\\begin{pmatrix} | &  &  \\\\  &  &  \\\\  &  &  \\end{pmatrix}',
      demo: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}',
      compact: '\\begin{smallmatrix} a & \\cdots & b \\\\ \\vdots & \\ddots & \\vdots \\\\ c & \\cdots & d \\end{smallmatrix}',
    },
    {
      glyph: '[2×2]', title: 'bracket matrix',
      latex: '\\begin{bmatrix} | &  \\\\  &  \\end{bmatrix}',
      demo: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
      compact: '\\left[ \\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix} \\right]',
    },
    {
      glyph: '⎧f(x)', title: 'piecewise',
      latex: '\\begin{cases} | &  \\\\  &  \\end{cases}',
      demo: 'f(x) = \\begin{cases} x^2, & x \\geq 0 \\\\ -x, & x < 0 \\end{cases}',
      compact: 'f(x) = \\begin{cases} a \\\\ b \\end{cases}',
    },
    {
      glyph: '⎧x+y', title: 'equation system',
      latex: '\\left\\{ \\begin{aligned} | &=  \\\\  &=  \\end{aligned} \\right.',
      demo: '\\left\\{ \\begin{aligned} x + y &= 3 \\\\ x - y &= 1 \\end{aligned} \\right.',
      compact: '\\left\\{ \\begin{smallmatrix} x + y = 3 \\\\ x - y = 1 \\end{smallmatrix} \\right.',
    },
    { glyph: 'a↦b', latex: '\\begin{aligned} | &=  \\end{aligned}', title: 'aligned', demo: '\\begin{aligned} y &= ax + b \\end{aligned}', compact: '\\begin{smallmatrix} y = ax + b \\end{smallmatrix}' },
  ],
}

// \alp → \alpha 自动补全词表（不含反斜杠）
export const autocompleteCommands: string[] = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'varrho', 'sigma', 'tau', 'upsilon',
  'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
  'pm', 'mp', 'times', 'div', 'cdot', 'ast', 'star', 'circ', 'bullet', 'oplus', 'otimes',
  'neq', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'leq', 'geq', 'll', 'gg', 'prec', 'succ',
  'propto', 'parallel', 'perp', 'angle', 'infty', 'ldots', 'cdots', 'vdots', 'ddots',
  'in', 'notin', 'ni', 'subset', 'supset', 'subseteq', 'supseteq', 'cup', 'cap', 'setminus',
  'emptyset', 'forall', 'exists', 'nexists', 'neg', 'land', 'lor', 'because', 'therefore',
  'to', 'mapsto', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow',
  'leftrightarrow', 'uparrow', 'downarrow',
  'int', 'iint', 'iiint', 'oint', 'sum', 'prod', 'lim', 'partial', 'nabla',
  'frac', 'dfrac', 'tfrac', 'sqrt', 'binom', 'vec', 'hat', 'bar', 'dot', 'ddot', 'tilde',
  'overline', 'underline', 'overbrace', 'underbrace', 'overrightarrow', 'overleftarrow',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'min', 'max', 'sup', 'inf', 'limsup', 'liminf',
  'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'mod', 'bmod', 'pmod',
  'mathbb', 'mathbf', 'mathrm', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathfrak', 'boldsymbol',
  'begin', 'end', 'text', 'quad', 'qquad', 'hspace', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
  'lfloor', 'rfloor', 'lceil', 'rceil', 'langle', 'rangle', 'lbrace', 'rbrace',
  'pmatrix', 'bmatrix', 'vmatrix', 'matrix', 'cases', 'aligned', 'align', 'array',
  'prime', 'degree', 'triangle', 'square', 'blacksquare', 'checkmark', 'dagger', 'hbar', 'imath', 'jmath',
  'Re', 'Im', 'aleph', 'wp', 'ell', 'top', 'bot', 'vdash', 'models', 'mid', 'nmid',
]

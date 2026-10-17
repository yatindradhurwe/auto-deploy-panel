import colors from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

/**
 * Theme-aware palette.
 *
 * Every neutral (`slate-*`, `white`) and accent colour class resolves to a CSS variable, so the
 * same markup renders in the dark theme or the light theme depending on <html data-theme>.
 *  - slate: dark surfaces/light text in dark mode, inverted (light surfaces/dark text) in light mode
 *  - white: text/hairline colour — white in dark mode, ink in light mode
 *  - accents: light shades (100–400) darken and deep shades (800–950) lighten in light mode,
 *    so text like `text-cyan-300` and tints like `bg-cyan-950/40` stay readable on white
 *  - onaccent: always white, for text and knobs on solid accent backgrounds
 */

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

const SLATE_DARK = {
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b',
  600: '#475569', 700: '#2a3242', 800: '#1a2030', 900: '#10141e', 950: '#090b12'
}
const SLATE_LIGHT = {
  50: '#0b1020', 100: '#101828', 200: '#1d2939', 300: '#344054', 400: '#4f5b6d', 500: '#667085',
  600: '#8b95a7', 700: '#d0d5dd', 800: '#e6e9ef', 900: '#ffffff', 950: '#f4f5f8'
}

const ACCENTS = ['cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'green', 'emerald', 'teal']
const ACCENT_LIGHT_SHADE = { 50: 900, 100: 800, 200: 800, 300: 700, 400: 600, 500: 500, 600: 600, 700: 700, 800: 200, 900: 100, 950: 50 }

const rgb = (hex) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

function scale(name) {
  return Object.fromEntries(SHADES.map((s) => [s, v(`${name}-${s}`)]))
}

function themeVars(mode) {
  const vars = {}
  for (const s of SHADES) vars[`--c-slate-${s}`] = rgb((mode === 'light' ? SLATE_LIGHT : SLATE_DARK)[s])
  for (const a of ACCENTS) {
    for (const s of SHADES) vars[`--c-${a}-${s}`] = rgb(colors[a][mode === 'light' ? ACCENT_LIGHT_SHADE[s] : s])
  }
  vars['--c-white'] = mode === 'light' ? rgb('#101828') : '255 255 255'
  return vars
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: scale('slate'),
        white: v('white'),
        onaccent: '#ffffff',
        ...Object.fromEntries(ACCENTS.map((a) => [a, scale(a)])),
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1'
        }
      },
      spacing: {
        4.5: '1.125rem',
        8.5: '2.125rem'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      }
    }
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root, [data-theme="dark"], .theme-dark': themeVars('dark'),
        '[data-theme="light"]': themeVars('light')
      })
    })
  ]
}

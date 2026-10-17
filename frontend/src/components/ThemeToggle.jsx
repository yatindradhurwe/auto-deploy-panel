import React from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../utils/theme'

const OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor }
]

/**
 * Theme switcher. `compact` is a single button that cycles light → dark → system (for headers);
 * the default is a segmented control (for settings pages and auth screens).
 */
export default function ThemeToggle({ compact = false, className = '' }) {
  const { preference, setTheme } = useTheme()

  if (compact) {
    const i = OPTIONS.findIndex((o) => o.id === preference)
    const current = OPTIONS[i]
    const next = OPTIONS[(i + 1) % OPTIONS.length]
    const Icon = current.icon
    return (
      <button
        type="button"
        onClick={() => setTheme(next.id)}
        title={`Theme: ${current.label} — switch to ${next.label}`}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-xl border border-slate-800 bg-slate-900/70 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0 ${className}`}
      >
        <Icon className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex items-center p-1 rounded-xl border border-slate-800 bg-slate-900/70 ${className}`}>
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const active = preference === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${active ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

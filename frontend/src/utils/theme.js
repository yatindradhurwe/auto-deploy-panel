import { useEffect, useState } from 'react'

/**
 * Light / dark / system theme. The preference lives in localStorage; index.html applies it
 * before first paint, and this module keeps <html data-theme> in sync afterwards.
 */

const KEY = 'autodeploy_theme'
const listeners = new Set()
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null

export function getThemePreference() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

const resolve = (pref) => (pref === 'system' ? (media?.matches ? 'light' : 'dark') : pref)

function apply(pref) {
  const root = document.documentElement
  const mode = resolve(pref)
  if (root.getAttribute('data-theme') !== mode) {
    root.classList.add('theme-switching')
    root.setAttribute('data-theme', mode)
    setTimeout(() => root.classList.remove('theme-switching'), 250)
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f4f5f8' : '#090b12')
}

export function setThemePreference(pref) {
  try { localStorage.setItem(KEY, pref) } catch { /* private mode */ }
  apply(pref)
  listeners.forEach((fn) => fn(pref))
}

media?.addEventListener?.('change', () => { if (getThemePreference() === 'system') apply('system') })
if (typeof window !== 'undefined') {
  // Keep tabs in sync
  window.addEventListener('storage', (e) => { if (e.key === KEY) { apply(getThemePreference()); listeners.forEach((fn) => fn(getThemePreference())) } })
}

export function useTheme() {
  const [pref, setPref] = useState(getThemePreference)
  useEffect(() => {
    listeners.add(setPref)
    return () => listeners.delete(setPref)
  }, [])
  return { preference: pref, theme: resolve(pref), setTheme: setThemePreference }
}

import React, { useEffect, useState } from 'react'
import { X, Search, AlertCircle, CheckCircle2, Copy, Check, Loader2 } from 'lucide-react'

export function Card({ title, icon: Icon, actions, children, className = '' }) {
  return (
    <section className={`bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-6 backdrop-blur-xl space-y-4 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 text-purple-400" />}
              <span>{title}</span>
            </h3>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'text-cyan-400' }) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-3 shadow-lg">
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</div>
        <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 tabular-nums">{value}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-1 truncate">{hint}</div>}
      </div>
      {Icon && (
        <div className={`p-3 bg-slate-950 border border-slate-800 rounded-xl shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  )
}

const BADGE_TONES = {
  green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  red: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  purple: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  slate: 'bg-slate-800 text-slate-300 border-slate-700'
}

export function Badge({ tone = 'slate', children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${BADGE_TONES[tone] || BADGE_TONES.slate}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  return status === 'suspended' ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>
}

export function Button({ variant = 'secondary', size = 'md', loading = false, children, className = '', ...props }) {
  const variants = {
    primary: 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white border-transparent shadow-lg shadow-purple-500/20',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
    danger: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30',
    success: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
  }
  const sizes = { sm: 'px-2.5 py-1 text-[11px]', md: 'px-3.5 py-2 text-xs' }
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
      />
    </div>
  )
}

export function Select({ value, onChange, options, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 ${props.className || ''}`}
    />
  )
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start justify-between gap-4 text-left cursor-pointer"
      role="switch"
      aria-checked={checked}
    >
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        {description && <span className="block text-xs text-slate-400 mt-0.5">{description}</span>}
      </span>
      <span className={`relative shrink-0 w-10 h-6 rounded-full transition ${checked ? 'bg-purple-600' : 'bg-slate-700'}`}>
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </span>
    </button>
  )
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl shadow-2xl`}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white truncate">{title}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-800 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Confirmation dialog. With `requireText`, the user must type it (used for irreversible deletes).
 * With `withReason`, a reason field is shown and passed to onConfirm.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', variant = 'danger', requireText, withReason, onConfirm, onClose }) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setTyped('')
      setReason('')
      setError('')
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason)
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={variant} loading={busy} disabled={requireText && typed !== requireText} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
      {withReason && (
        <Field label="Reason (shown to the user)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Payment overdue" maxLength={300} />
        </Field>
      )}
      {requireText && (
        <Field label={`Type "${requireText}" to confirm`}>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Field>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </Modal>
  )
}

export function Alert({ tone = 'error', children }) {
  const isError = tone === 'error'
  const Icon = isError ? AlertCircle : CheckCircle2
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${isError ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'}`}>
      <Icon className="w-4 h-4 shrink-0 mt-px" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

/**
 * Shows a one-time secret (e.g. a temporary password) with a copy button.
 */
export function SecretReveal({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {}
  }
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono">{value}</code>
        <Button size="sm" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-[11px] text-amber-200/80">Shown only once. Share it securely; the user should change it after signing in.</p>
    </div>
  )
}

export function EmptyState({ children }) {
  return <div className="py-10 text-center text-xs text-slate-500">{children}</div>
}

export function Loading() {
  return (
    <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
      Loading…
    </div>
  )
}

/**
 * Loads data with loading/error state and a reload function.
 */
export function useAdminData(loader, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      setData(await loader())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload, setData }
}

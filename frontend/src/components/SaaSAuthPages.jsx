import React, { useState } from 'react'
import {
  Rocket,
  Shield,
  Zap,
  Server,
  Terminal,
  Check,
  Copy,
  ArrowRight,
  User,
  Mail,
  Lock,
  Building,
  CheckCircle,
  Sparkles,
  CreditCard,
  Cpu
} from 'lucide-react'

export default function SaaSAuthPages({ onAuthSuccess, apiBaseUrl = '' }) {
  const [view, setView] = useState('login') // 'login' | 'signup' | 'onboarding'
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    orgName: '',
    planId: 'STARTER'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  
  // Onboarding step state
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [installCommand, setInstallCommand] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [userObj, setUserObj] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')

      localStorage.setItem('autodeploy_token', data.token)
      localStorage.setItem('autodeploy_user', JSON.stringify(data.user))

      if (onAuthSuccess) {
        onAuthSuccess(data.token, data.user)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName,
          email: formData.email,
          password: formData.password,
          orgName: formData.orgName
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Signup failed')

      localStorage.setItem('autodeploy_token', data.token)
      localStorage.setItem('autodeploy_user', JSON.stringify(data.user))
      
      setAuthToken(data.token)
      setUserObj(data.user)

      // Transition to Onboarding Wizard
      setView('onboarding')
      setOnboardingStep(1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteOnboarding = async () => {
    setLoading(true)
    setError('')

    try {
      const token = authToken || localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/auth/onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          orgName: formData.orgName,
          planId: formData.planId
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Onboarding failed')

      setInstallCommand(data.installCommand || '')
      setOnboardingStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-black bg-gradient-to-r from-cyan-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent tracking-wider">
              AutoDeploy
            </div>
            <div className="text-xs text-slate-400 font-mono">Autonomous Multi-Tenant Cloud Platform</div>
          </div>
        </div>

        {view !== 'onboarding' && (
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setView('login')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                view === 'login'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setView('signup')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                view === 'signup'
                  ? 'bg-gradient-to-r from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              Start Free Trial
            </button>
          </div>
        )}
      </header>

      {/* Main Form Container */}
      <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Background Decorative Glow */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {view === 'login' && (
          <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Welcome Back</h2>
              <p className="text-sm text-slate-400">Sign in to your AutoDeploy Organization Workspace</p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="name@company.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center space-x-2"
              >
                {loading ? <Zap className="w-5 h-5 animate-spin" /> : <><span>Sign In to Dashboard</span><ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-800/80 text-center text-xs text-slate-400">
              Default Admin Email: <span className="text-cyan-400 font-mono">admin@tipcrm.com</span> | Password: <span className="text-cyan-400 font-mono">admin123</span>
            </div>
          </div>
        )}

        {view === 'signup' && (
          <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Create Workspace</h2>
              <p className="text-sm text-slate-400">Deploy applications on your own servers in minutes</p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="Alex Morgan"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Workspace / Company Name</label>
                <div className="relative">
                  <Building className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={formData.orgName}
                    onChange={(e) => setFormData({ ...formData, orgName: e.target.value })}
                    placeholder="Acme Cloud Technologies"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="alex@acme.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center space-x-2"
              >
                {loading ? <Zap className="w-5 h-5 animate-spin" /> : <><span>Create Workspace</span><ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
        )}

        {/* Onboarding Wizard */}
        {view === 'onboarding' && (
          <div className="w-full max-w-3xl bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
            {/* Step Indicators */}
            <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-800">
              <div className={`flex items-center space-x-3 ${onboardingStep >= 1 ? 'text-cyan-400' : 'text-slate-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${onboardingStep >= 1 ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>1</div>
                <span className="font-semibold text-sm">Select Plan</span>
              </div>
              <div className="w-12 h-0.5 bg-slate-800" />
              <div className={`flex items-center space-x-3 ${onboardingStep >= 2 ? 'text-cyan-400' : 'text-slate-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${onboardingStep >= 2 ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>2</div>
                <span className="font-semibold text-sm">Connect VPS Server</span>
              </div>
              <div className="w-12 h-0.5 bg-slate-800" />
              <div className={`flex items-center space-x-3 ${onboardingStep >= 3 ? 'text-cyan-400' : 'text-slate-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${onboardingStep >= 3 ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>3</div>
                <span className="font-semibold text-sm">Ready to Deploy</span>
              </div>
            </div>

            {onboardingStep === 1 && (
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Choose Subscription Tier</h3>
                <p className="text-sm text-slate-400 mb-6">Select a plan for your organization's deployment needs</p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  {[
                    { id: 'FREE', name: 'Free Starter', price: '$0', servers: '1 VPS', projects: '2 Apps' },
                    { id: 'STARTER', name: 'Developer Starter', price: '$19/mo', servers: '3 VPS', projects: '10 Apps', recommended: true },
                    { id: 'PROFESSIONAL', name: 'Pro DevOps', price: '$49/mo', servers: '10 VPS', projects: '35 Apps' }
                  ].map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setFormData({ ...formData, planId: p.id })}
                      className={`cursor-pointer border rounded-2xl p-5 relative transition-all ${
                        formData.planId === p.id
                          ? 'bg-cyan-500/10 border-cyan-500 shadow-lg shadow-cyan-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {p.recommended && (
                        <span className="absolute -top-3 right-4 px-3 py-0.5 bg-cyan-500 text-slate-950 font-black text-[10px] rounded-full uppercase">
                          Recommended
                        </span>
                      )}
                      <div className="font-bold text-white text-lg">{p.name}</div>
                      <div className="text-2xl font-black text-cyan-400 my-2">{p.price}</div>
                      <ul className="text-xs text-slate-400 space-y-1.5 font-medium">
                        <li className="flex items-center space-x-2"><Check className="w-3.5 h-3.5 text-cyan-400" /><span>{p.servers}</span></li>
                        <li className="flex items-center space-x-2"><Check className="w-3.5 h-3.5 text-cyan-400" /><span>{p.projects}</span></li>
                        <li className="flex items-center space-x-2"><Check className="w-3.5 h-3.5 text-cyan-400" /><span>SSL & Webmail</span></li>
                      </ul>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleCompleteOnboarding}
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/25 flex items-center justify-center space-x-2"
                >
                  {loading ? <Zap className="w-5 h-5 animate-spin" /> : <><span>Continue to Server Agent Setup</span><ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            )}

            {onboardingStep === 3 && (
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Install AutoDeploy Agent Node</h3>
                <p className="text-sm text-slate-400 mb-6">Run this command on your Ubuntu/Debian server terminal to register it automatically:</p>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-cyan-300 relative mb-6">
                  <button
                    onClick={() => copyToClipboard(installCommand)}
                    className="absolute right-3 top-3 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <div className="pr-12 break-all">{installCommand || 'curl -fsSL https://automate-deployment.yjtechnosoft.com/install.sh | sudo bash'}</div>
                </div>

                <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs mb-8 flex items-start space-x-3">
                  <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-0.5">Pre-connected Production Server Available</div>
                    You can also use your pre-configured server <strong>187.127.165.128</strong> in your organization dashboard immediately.
                  </div>
                </div>

                <button
                  onClick={() => {
                    const token = authToken || localStorage.getItem('autodeploy_token')
                    const user = userObj || JSON.parse(localStorage.getItem('autodeploy_user') || '{}')
                    if (onAuthSuccess) onAuthSuccess(token, user)
                  }}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>Enter Organization Console</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import {
  Server, Terminal, ShieldCheck, Globe, Zap, Cpu, CheckCircle2,
  XCircle, AlertTriangle, Play, RefreshCw, Copy, Check, Lock, HardDrive, Code
} from 'lucide-react'

const DEFAULT_CONFIG = {
  host: '187.127.165.128',
  port: '22',
  username: 'root',
  password: 'Yatindra@1223',
  domain: 'tip-crm.yjtechnosoft.com',
  gitRepoUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
  remoteDir: '/var/www/tip-crm',
  appName: 'tip-crm-backend',
  backendPort: 5050,
  setupSsl: true,
}

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [testingSsh, setTestingSsh] = useState(false)
  const [sshStatus, setSshStatus] = useState(null)
  
  const [scanningPorts, setScanningPorts] = useState(false)
  const [scanResult, setScanResult] = useState(null)

  const [deploying, setDeploying] = useState(false)
  const [deployId, setDeployId] = useState(null)
  const [logs, setLogs] = useState([])
  const [currentStep, setCurrentStep] = useState('IDLE')
  const [deploySuccess, setDeploySuccess] = useState(null)
  const [copied, setCopied] = useState(false)

  const terminalEndRef = useRef(null)

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Handle SSE log streaming
  useEffect(() => {
    if (!deployId) return

    const eventSource = new EventSource(`/api/deploy/stream/${deployId}`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setLogs((prev) => [...prev, data])
        if (data.step) setCurrentStep(data.step)
        if (data.step === 'END') {
          setDeploying(false)
          setDeploySuccess(!data.isError)
          eventSource.close()
        }
      } catch (e) {
        console.error('Failed to parse SSE payload', e)
      }
    }

    eventSource.onerror = (err) => {
      console.error('SSE connection error', err)
      eventSource.close()
      setDeploying(false)
    }

    return () => {
      eventSource.close()
    }
  }, [deployId])

  const handleInputChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handlePresetServer = () => {
    setConfig(DEFAULT_CONFIG)
    setSshStatus(null)
    setScanResult(null)
  }

  const handleTestSsh = async () => {
    setTestingSsh(true)
    setSshStatus(null)
    try {
      const res = await fetch('/api/deploy/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success) {
        setSshStatus({ type: 'success', message: 'SSH Connection Verified!', details: data.rawInfo })
      } else {
        setSshStatus({ type: 'error', message: data.error || 'Connection Failed' })
      }
    } catch (err) {
      setSshStatus({ type: 'error', message: err.message })
    } finally {
      setTestingSsh(false)
    }
  }

  const handleScanPorts = async () => {
    setScanningPorts(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/deploy/scan-ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success) {
        setScanResult(data)
        if (data.suggestedPort) {
          handleInputChange('backendPort', data.suggestedPort)
        }
      } else {
        alert(`Port scan failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Port scan error: ${err.message}`)
    } finally {
      setScanningPorts(false)
    }
  }

  const handleTriggerDeploy = async () => {
    if (!config.host || !config.domain) {
      alert('Please provide Server IP and Public Domain Name before deploying.')
      return
    }

    setDeploying(true)
    setLogs([])
    setDeploySuccess(null)
    setCurrentStep('INIT')

    try {
      const res = await fetch('/api/deploy/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success && data.deployId) {
        setDeployId(data.deployId)
      } else {
        setDeploying(false)
        alert(`Deployment error: ${data.error}`)
      }
    } catch (err) {
      setDeploying(false)
      alert(`Deployment request failed: ${err.message}`)
    }
  }

  const handleCopyLogs = () => {
    const text = logs.map((l) => l.text).join('')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="h-6 w-6 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">AutoDeploy Console</span>
                <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-mono">v1.0.0</span>
              </div>
              <p className="text-xs text-slate-400">One-Click Server Deployment & Domain Manager</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handlePresetServer}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-2 transition"
            >
              <Server className="h-3.5 w-3.5 text-cyan-400" />
              <span>Fill Saved Server Profile</span>
            </button>

            <a
              href={`https://${config.domain}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>https://{config.domain}</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Top Info Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                Deploy Software to Public Server & Domain
              </h1>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Configure target SSH credentials, specify your public domain name, auto-detect non-conflicting backend ports, and watch live execution logs in real time.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-slate-400">Target Public Domain</div>
                <div className="text-sm font-mono font-semibold text-cyan-400">https://{config.domain}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 1 & Step 2 Forms Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Card 1: Server SSH Credentials */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">1. Server Connection (SSH)</h2>
                  <p className="text-xs text-slate-400">Target Linux Server IP & Access Credentials</p>
                </div>
              </div>

              <button
                onClick={handleTestSsh}
                disabled={testingSsh}
                className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-400 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${testingSsh ? 'animate-spin' : ''}`} />
                <span>{testingSsh ? 'Testing...' : 'Test SSH Connection'}</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Server IP Address</label>
                <input
                  type="text"
                  value={config.host}
                  onChange={(e) => handleInputChange('host', e.target.value)}
                  placeholder="e.g. 187.127.165.128"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Port</label>
                <input
                  type="text"
                  value={config.port}
                  onChange={(e) => handleInputChange('port', e.target.value)}
                  placeholder="22"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Username</label>
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="root"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Password</label>
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* SSH Test Status Result */}
            {sshStatus && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-mono space-y-1 ${
                  sshStatus.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}
              >
                <div className="flex items-center space-x-2 font-semibold">
                  {sshStatus.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  <span>{sshStatus.message}</span>
                </div>
                {sshStatus.details && <p className="text-[11px] opacity-80 whitespace-pre-wrap mt-1">{sshStatus.details}</p>}
              </div>
            )}
          </div>

          {/* Card 2: Software & Domain Config */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-lg">
            <div className="flex items-center space-x-3 border-b border-slate-800 pb-4">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">2. Public Domain & Repo Config</h2>
                <p className="text-xs text-slate-400">Target Public Domain & GitHub Source</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                <span>Target Public Domain Name</span>
                <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">Nginx + SSL Auto-Configured</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={config.domain}
                  onChange={(e) => handleInputChange('domain', e.target.value)}
                  placeholder="e.g. tip-crm.yjtechnosoft.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                />
                <Globe className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Git Repository URL</label>
              <div className="relative">
                <input
                  type="text"
                  value={config.gitRepoUrl}
                  onChange={(e) => handleInputChange('gitRepoUrl', e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <Code className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Remote App Path</label>
                <input
                  type="text"
                  value={config.remoteDir}
                  onChange={(e) => handleInputChange('remoteDir', e.target.value)}
                  placeholder="/var/www/my-app"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">PM2 Process Name</label>
                <input
                  type="text"
                  value={config.appName}
                  onChange={(e) => handleInputChange('appName', e.target.value)}
                  placeholder="my-app-backend"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.setupSsl}
                  onChange={(e) => handleInputChange('setupSsl', e.target.checked)}
                  className="rounded border-slate-800 text-cyan-500 focus:ring-cyan-500 bg-slate-950"
                />
                <span>Auto-provision SSL Certificate (Certbot Let's Encrypt)</span>
              </label>

              <div className="flex items-center space-x-1.5 text-xs text-slate-400">
                <span>Backend Port:</span>
                <span className="font-mono text-cyan-400 font-bold">{config.backendPort}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Server Port & Service Inspection Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">3. Non-Conflicting Port Inspection & Service Monitor</h2>
                <p className="text-xs text-slate-400">Scan active server ports & ensure existing apps are protected</p>
              </div>
            </div>

            <button
              onClick={handleScanPorts}
              disabled={scanningPorts}
              className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanningPorts ? 'animate-spin' : ''}`} />
              <span>{scanningPorts ? 'Scanning Server...' : 'Scan Ports & Active Services'}</span>
            </button>
          </div>

          {scanResult ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                  <span>Suggested Backend Port</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {scanResult.suggestedPort}
                </div>
                <p className="text-[11px] text-slate-500">Unused port assigned automatically to prevent conflicts.</p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400">Active PM2 Services</div>
                <div className="space-y-1.5 max-h-24 overflow-y-auto">
                  {scanResult.pm2Apps && scanResult.pm2Apps.length > 0 ? (
                    scanResult.pm2Apps.map((app) => (
                      <div key={app.id} className="flex items-center justify-between text-xs font-mono bg-slate-900 px-2 py-1 rounded">
                        <span className="text-slate-300 font-semibold">{app.name}</span>
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{app.status}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">No active PM2 apps found</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400">Listening System Ports</div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {scanResult.activePorts?.map((port) => (
                    <span key={port} className="text-[11px] font-mono bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded">
                      :{port}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/50 p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
              Click <strong className="text-amber-400">"Scan Ports & Active Services"</strong> to verify server resources and detect open ports.
            </div>
          )}
        </div>

        {/* Step 4: Action Button & Interactive Live Terminal */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">4. Live Execution Terminal</h2>
                <p className="text-xs text-slate-400">Watch real-time SSH output during automated deployment</p>
              </div>
            </div>

            <button
              onClick={handleTriggerDeploy}
              disabled={deploying}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 flex items-center justify-center space-x-2 transition text-sm cursor-pointer"
            >
              {deploying ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-slate-950" />
                  <span>Deploying to {config.domain}...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 text-slate-950 fill-current" />
                  <span>🚀 Launch Automated Deployment to Public Domain</span>
                </>
              )}
            </button>
          </div>

          {/* Terminal Console Box */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl font-mono text-xs">
            {/* Terminal Header */}
            <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-rose-500/80"></div>
                <div className="h-3 w-3 rounded-full bg-amber-500/80"></div>
                <div className="h-3 w-3 rounded-full bg-emerald-500/80"></div>
                <span className="text-slate-400 text-xs ml-2 font-mono">root@{config.host}:~# ./deploy.sh --domain {config.domain}</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyLogs}
                  disabled={logs.length === 0}
                  className="text-[11px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 bg-slate-950 px-2.5 py-1 rounded-md flex items-center space-x-1 transition disabled:opacity-40"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? 'Copied' : 'Copy Logs'}</span>
                </button>
              </div>
            </div>

            {/* Terminal Output Body */}
            <div className="p-4 h-96 overflow-y-auto space-y-1 font-mono text-slate-300 leading-relaxed bg-slate-950">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                  <Terminal className="h-8 w-8 text-slate-700" />
                  <p className="text-xs">Terminal ready. Click "Launch Automated Deployment" above to begin.</p>
                </div>
              ) : (
                logs.map((item, idx) => (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap ${
                      item.isError ? 'text-rose-400 font-semibold' : item.step === 'COMPLETE' ? 'text-emerald-400 font-bold' : 'text-slate-300'
                    }`}
                  >
                    {item.text}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>

            {/* Terminal Footer Status Bar */}
            <div className="bg-slate-900/80 px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <div className="flex items-center space-x-2">
                <span>Status:</span>
                <span className={`font-semibold ${deploying ? 'text-amber-400 animate-pulse' : deploySuccess ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {deploying ? `Deploying (${currentStep})...` : deploySuccess ? 'Deployment Successful' : 'Idle'}
                </span>
              </div>

              {deploySuccess && (
                <a
                  href={`https://${config.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 hover:underline flex items-center space-x-1"
                >
                  <span>Open https://{config.domain}</span>
                  <Globe className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500 font-mono">
        AutoDeploy Console &copy; 2026 · Standalone Server Deployment & Public Domain Manager
      </footer>
    </div>
  )
}

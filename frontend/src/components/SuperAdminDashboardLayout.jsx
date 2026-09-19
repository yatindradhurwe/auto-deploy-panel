import React, { useState, useEffect } from 'react'
import {
  Crown, Users, Building, Server, RefreshCw, Zap, ShieldAlert, BarChart3,
  LogOut, Layers, Key, Activity, Clock, ShieldCheck, CreditCard, ChevronRight,
  Eye, AlertTriangle, ArrowLeft
} from 'lucide-react'
import SuperAdminPortal from './SuperAdminPortal'
import { AdminIdempotencyPanel } from './AdminIdempotencyPanel'

export default function SuperAdminDashboardLayout({ currentUser, jwtToken, onLogout, onExitImpersonation, apiBaseUrl = '' }) {
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' | 'users' | 'organizations' | 'servers' | 'subscriptions' | 'audit-logs' | 'idempotency'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [impersonatingOrg, setImpersonatingOrg] = useState(null)

  const adminNavSections = [
    {
      title: 'PLATFORM MANAGEMENT',
      items: [
        { id: 'dashboard', label: 'Platform Analytics', icon: BarChart3 },
        { id: 'users', label: 'Registered Users', icon: Users },
        { id: 'organizations', label: 'Customer Organizations', icon: Building },
        { id: 'servers', label: 'Global Server Inventory', icon: Server }
      ]
    },
    {
      title: 'BUSINESS & REVENUE',
      items: [
        { id: 'subscriptions', label: 'Active Subscriptions', icon: CreditCard }
      ]
    },
    {
      title: 'SYSTEM & SECURITY',
      items: [
        { id: 'audit-logs', label: 'Platform Audit Trail', icon: ShieldCheck },
        { id: 'idempotency', label: 'Idempotency System', icon: RefreshCw }
      ]
    }
  ]

  const handleImpersonate = (orgId) => {
    setImpersonatingOrg(orgId)
    // Redirect to customer dashboard with support banner
    window.location.hash = '#/app/dashboard'
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-500/30 selection:text-purple-200">
      {/* Super Admin Top Header */}
      <header className="border-b border-purple-500/30 bg-slate-950/90 backdrop-blur-2xl sticky top-0 z-40 shadow-2xl">
        <div className="px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-amber-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Crown className="w-5 h-5 text-amber-300" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-white">AutoDeploy</span>
              <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full font-mono font-bold tracking-wider">
                SUPER ADMIN PORTAL
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <a
              href="/app/dashboard"
              className="text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Enter Customer Dashboard</span>
            </a>

            <div className="flex items-center space-x-2 bg-slate-900 border border-purple-500/30 rounded-xl px-3 py-1 text-xs">
              <div className="w-5 h-5 rounded-full bg-amber-400 text-slate-950 font-bold flex items-center justify-center text-[10px]">
                A
              </div>
              <span className="font-bold text-amber-300">Platform Admin</span>
              <button onClick={onLogout} className="text-slate-400 hover:text-rose-400 p-0.5 ml-1">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Admin Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className={`bg-slate-950 border-r border-purple-500/20 backdrop-blur-xl flex flex-col justify-between transition-all duration-300 z-30 select-none ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="p-3 space-y-6 overflow-y-auto">
            {adminNavSections.map((section, idx) => (
              <div key={idx} className="space-y-1">
                {!sidebarCollapsed && (
                  <div className="px-3 text-[10px] font-mono font-bold text-purple-400/80 tracking-wider uppercase mb-1.5">
                    {section.title}
                  </div>
                )}
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'} rounded-xl text-xs transition-all cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-lg shadow-purple-500/20'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-amber-300' : 'text-slate-400'}`} />
                        {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Central Super Admin View */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'idempotency' ? (
            <AdminIdempotencyPanel jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />
          ) : (
            <SuperAdminPortal apiBaseUrl={apiBaseUrl} />
          )}
        </main>
      </div>
    </div>
  )
}

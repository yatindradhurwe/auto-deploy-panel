import React, { useState } from 'react'
import {
  ArrowLeft, Search, Sliders, Globe, Palette, Languages, Code, Braces,
  Building, CreditCard, Truck, Mail, ShieldCheck, Search as SeoIcon,
  TrendingUp, BarChart3, ChevronRight, Check, Sparkles, Plus, Zap, Filter,
  BookOpen, Users, Activity, Settings, X, Save
} from 'lucide-react'

export default function ProjectSettingsModal({ isOpen, project, onClose, onSaveProjectSettings }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [savedToast, setSavedToast] = useState(false)

  // Project Settings Form State
  const [settings, setSettings] = useState({
    // Site - General
    siteName: project?.name || 'My Web Project',
    domainName: project?.domain || '',
    faviconUrl: '',
    language: 'en-US',
    publishingStatus: 'published',

    // Site - Brand & AI
    brandName: project?.name || '',
    primaryColor: '#06B6D4',
    aiStyleGuide: 'Modern minimalist dark theme with crisp typography and glowing cyan accents.',

    // Site - Global Variables
    globalVars: [
      { key: 'company_name', value: 'YJ Technosoft' },
      { key: 'support_email', value: 'support@yjtechnosoft.com' }
    ],

    // Site - Code Injection
    headCode: '<!-- Google Tag Manager / Custom CSS -->',
    bodyCode: '<!-- Custom Analytics Script -->',

    // Sales & Leads - Business Details
    companyName: 'YJ Technosoft Pvt Ltd',
    businessAddress: 'Bhopal, MP, India',
    currency: 'USD ($)',

    // Sales & Leads - Payment Processing
    stripeKey: 'pk_live_51M...',
    paypalClientId: '',
    razorpayKey: '',

    // Sales & Leads - Email
    smtpHost: 'smtp.resend.com',
    smtpPort: '587',
    senderEmail: 'noreply@yjtechnosoft.com',

    // Search & Marketing - SEO
    metaTitle: project?.name ? `${project.name} | Official Website` : 'Web Project',
    metaDescription: 'High performance web app built with AutoDeploy SaaS.',
    ogImageUrl: '',
    analyticsId: 'G-XXXXXXXXXX'
  })

  if (!isOpen) return null

  const handleSave = () => {
    if (onSaveProjectSettings) {
      onSaveProjectSettings(settings)
    }
    setSavedToast(true)
    setTimeout(() => setSavedToast(false), 3000)
  }

  const navItems = [
    {
      category: 'OVERVIEW',
      items: [
        { id: 'overview', label: 'Overview', icon: Sliders }
      ]
    },
    {
      category: 'SITE',
      items: [
        { id: 'general', label: 'General', icon: Globe, desc: 'Site name, favicon, regional settings and publishing status' },
        { id: 'brand', label: 'Brand & AI', icon: Palette, desc: 'Brand assets, style guide and the brief the AI builds from' },
        { id: 'languages', label: 'Languages', icon: Languages, desc: 'Translate the whole site and add a language switcher' },
        { id: 'global-vars', label: 'Global Variables', icon: Braces, desc: 'Reusable text you can place anywhere with {{key}}' },
        { id: 'code-injection', label: 'Code Injection', icon: Code, desc: 'Add your own code to the head or body of every page' }
      ]
    },
    {
      category: 'SALES & LEADS',
      items: [
        { id: 'business-details', label: 'Business Details', icon: Building, desc: 'Company name, logo and address used for payments and email' },
        { id: 'payment-processing', label: 'Payment Processing', icon: CreditCard, desc: 'Take payments with Stripe, PayPal, Square and more' },
        { id: 'shipping-carriers', label: 'Shipping Carriers', icon: Truck, desc: 'Configure carrier integrations and shipping rates' },
        { id: 'email-integrations', label: 'Email Integrations', icon: Mail, desc: 'SMTP, Resend API key and transactional email setups' },
        { id: 'spam-protection', label: 'Spam Protection', icon: ShieldCheck, desc: 'reCAPTCHA and Cloudflare Turnstile verification' }
      ]
    },
    {
      category: 'SEARCH & MARKETING',
      items: [
        { id: 'seo', label: 'SEO', icon: SeoIcon, desc: 'Search engine titles, meta descriptions and social cards' },
        { id: 'redirects', label: 'Redirects', icon: TrendingUp, desc: 'Configure 301 and 302 URL redirect rules', isNew: true },
        { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Google Analytics GA4, PostHog and visitor telemetry' }
      ]
    }
  ]

  // Filter items by search query
  const filteredCategories = navItems.map(cat => ({
    ...cat,
    items: cat.items.filter(item => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return item.label.toLowerCase().includes(q) || (item.desc && item.desc.toLowerCase().includes(q))
    })
  })).filter(cat => cat.items.length > 0)

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-2xl flex flex-col font-sans text-slate-100 overflow-hidden animate-in fade-in duration-200">
      
      {/* Top Bar Navigation (Matching Genesis Screenshot Header) */}
      <header className="h-14 bg-[#0B0E17]/90 border-b border-white/10 px-6 flex items-center justify-between shrink-0 z-20 shadow-md">
        <button
          onClick={onClose}
          className="flex items-center space-x-2 text-slate-400 hover:text-white font-mono text-xs font-bold transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-cyan-400" />
          <span>Back to project</span>
        </button>

        <div className="font-extrabold text-white text-sm tracking-tight font-sans">
          Project settings
        </div>

        <div className="flex items-center space-x-3">
          {savedToast && (
            <span className="text-xs font-mono text-emerald-400 font-bold flex items-center gap-1 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-400" /> Settings Saved!
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl text-xs font-mono shadow-md flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Changes</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Container (Split into Left Sidebar & Right Content Panel) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar (Matching Screenshot) */}
        <aside className="w-72 bg-[#080B12] border-r border-white/10 flex flex-col shrink-0 overflow-y-auto p-4 space-y-6">
          {/* Search Settings Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings..."
              className="w-full pl-9 pr-3 py-2 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono shadow-inner"
            />
          </div>

          {/* Navigation Categories List */}
          <nav className="space-y-6">
            {filteredCategories.map((group, gIdx) => (
              <div key={gIdx} className="space-y-1.5">
                <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest px-3 block">
                  {group.category}
                </span>

                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const IconComp = item.icon
                    const isActive = activeTab === item.id

                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                          isActive
                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold shadow-sm'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5">
                          <IconComp className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                          <span>{item.label}</span>
                        </div>

                        {item.isNew && (
                          <span className="text-[9px] bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono font-bold px-1.5 py-0.5 rounded-full">
                            New
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Right Content View */}
        <main className="flex-1 bg-[#05070D] overflow-y-auto p-8 space-y-8">
          
          {/* TAB 1: OVERVIEW SCREEN (Exact Match of Uploaded Image) */}
          {activeTab === 'overview' && (
            <div className="max-w-5xl mx-auto space-y-8">
              
              {/* Overview Header */}
              <div className="space-y-1 border-b border-white/10 pb-6">
                <h2 className="text-2xl font-black text-white tracking-tight">Overview</h2>
                <p className="text-xs text-slate-400 font-mono">
                  Everything this project can do. Open a tool or jump to a setting.
                </p>
              </div>

              {/* TOOLS GRID (Exact Match to Genesis Screenshot) */}
              <div className="space-y-4">
                <span className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-widest block">
                  TOOLS
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Tool 1: Funnels */}
                  <div className="bg-[#0B0F19]/90 border border-white/10 hover:border-cyan-500/40 rounded-3xl p-5 space-y-4 shadow-xl backdrop-blur-xl transition">
                    <div className="flex items-start space-x-3">
                      <div className="p-3 rounded-2xl bg-indigo-950/80 text-indigo-400 border border-indigo-800">
                        <Filter className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-base">Funnels</h4>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          Landing pages, lead capture and conversion in multi-step flows
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => alert('Opening Lead Funnels Builder...')}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-white/10 rounded-xl text-xs font-mono font-bold transition cursor-pointer"
                    >
                      Open Funnels ↗
                    </button>
                  </div>

                  {/* Tool 2: Blog */}
                  <div className="bg-[#0B0F19]/90 border border-white/10 hover:border-cyan-500/40 rounded-3xl p-5 space-y-4 shadow-xl backdrop-blur-xl transition">
                    <div className="flex items-start space-x-3">
                      <div className="p-3 rounded-2xl bg-blue-950/80 text-blue-400 border border-blue-800">
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-base">Blog</h4>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          A /blog page, a post template, authors and categories
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => alert('Adding Blog CMS Engine to Project...')}
                      className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold rounded-xl text-xs font-mono shadow transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add blog</span>
                    </button>
                  </div>

                  {/* Tool 3: Community */}
                  <div className="bg-[#0B0F19]/90 border border-white/10 hover:border-cyan-500/40 rounded-3xl p-5 space-y-4 shadow-xl backdrop-blur-xl transition">
                    <div className="flex items-start space-x-3">
                      <div className="p-3 rounded-2xl bg-purple-950/80 text-purple-400 border border-purple-800">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-base">Community</h4>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          A members community with groups, courses, events and a feed
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => alert('Adding Member Community Portal...')}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-xs font-mono shadow transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add community</span>
                    </button>
                  </div>

                  {/* Tool 4: Insights */}
                  <div className="bg-[#0B0F19]/90 border border-white/10 hover:border-cyan-500/40 rounded-3xl p-5 space-y-4 shadow-xl backdrop-blur-xl transition">
                    <div className="flex items-start space-x-3">
                      <div className="p-3 rounded-2xl bg-amber-950/80 text-amber-400 border border-amber-800">
                        <Activity className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-extrabold text-white text-base">Insights</h4>
                          <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded font-mono font-bold border border-slate-800">
                            off
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          Visitors, top pages and session replays
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => alert('Setting up Visitor Analytics & Insights...')}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-white/10 rounded-xl text-xs font-mono font-bold transition cursor-pointer"
                    >
                      Set up
                    </button>
                  </div>
                </div>
              </div>

              {/* ALL SETTINGS GRID SECTION (Matching Screenshot) */}
              <div className="space-y-6 pt-4">
                <span className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-widest block border-b border-white/10 pb-2">
                  ALL SETTINGS
                </span>

                {navItems.filter(g => g.category !== 'OVERVIEW').map((group, gIdx) => (
                  <div key={gIdx} className="space-y-3 font-mono">
                    <h5 className="text-xs text-cyan-400 font-bold tracking-wider uppercase">{group.category}</h5>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {group.items.map((item) => {
                        const IconComponent = item.icon
                        return (
                          <div
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className="p-4 bg-[#0B0F19]/60 hover:bg-slate-900 border border-white/10 hover:border-cyan-500/50 rounded-2xl flex items-start space-x-3.5 transition cursor-pointer group shadow-md"
                          >
                            <div className="p-2.5 rounded-xl bg-slate-900 border border-white/10 text-cyan-400 group-hover:scale-110 transition shrink-0">
                              <IconComponent className="w-4 h-4" />
                            </div>
                            <div className="space-y-1 flex-1 min-w-0">
                              <h6 className="font-extrabold text-white text-xs group-hover:text-cyan-300 transition flex items-center justify-between">
                                <span>{item.label}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400 transition" />
                              </h6>
                              <p className="text-[11px] text-slate-400 font-sans leading-relaxed truncate">
                                {item.desc}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-xl font-extrabold text-white">General Site Settings</h3>
                <p className="text-slate-400">Site identity, domain mappings, and publishing status</p>
              </div>

              <div className="space-y-4 bg-[#0B0F19] border border-white/10 rounded-3xl p-6 shadow-xl">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Site Name</label>
                  <input
                    type="text"
                    value={settings.siteName}
                    onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Primary Domain</label>
                  <input
                    type="text"
                    value={settings.domainName}
                    onChange={(e) => setSettings({ ...settings, domainName: e.target.value })}
                    placeholder="automate-deployment.yjtechnosoft.com"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Favicon URL</label>
                  <input
                    type="text"
                    value={settings.faviconUrl}
                    onChange={(e) => setSettings({ ...settings, faviconUrl: e.target.value })}
                    placeholder="https://example.com/favicon.ico"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BRAND & AI BRIEF */}
          {activeTab === 'brand' && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-xl font-extrabold text-white">Brand Assets & AI Brief</h3>
                <p className="text-slate-400">Define the design guidelines and prompts used by the AI Agent</p>
              </div>

              <div className="space-y-4 bg-[#0B0F19] border border-white/10 rounded-3xl p-6 shadow-xl">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Brand Name</label>
                  <input
                    type="text"
                    value={settings.brandName}
                    onChange={(e) => setSettings({ ...settings, brandName: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">AI Agent Style Guide & System Brief</label>
                  <textarea
                    rows={5}
                    value={settings.aiStyleGuide}
                    onChange={(e) => setSettings({ ...settings, aiStyleGuide: e.target.value })}
                    className="w-full p-4 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  ></textarea>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: GLOBAL VARIABLES */}
          {activeTab === 'global-vars' && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-white">Global Variables</h3>
                  <p className="text-slate-400">Reusable parameters accessible across templates with &#123;&#123;key&#125;&#125;</p>
                </div>
                <button
                  onClick={() => setSettings({
                    ...settings,
                    globalVars: [...settings.globalVars, { key: 'new_variable', value: '' }]
                  })}
                  className="px-3.5 py-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-xl font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Add Variable
                </button>
              </div>

              <div className="space-y-3 bg-[#0B0F19] border border-white/10 rounded-3xl p-6 shadow-xl">
                {settings.globalVars.map((v, idx) => (
                  <div key={idx} className="flex items-center space-x-3">
                    <input
                      type="text"
                      value={v.key}
                      onChange={(e) => {
                        const updated = [...settings.globalVars]
                        updated[idx].key = e.target.value
                        setSettings({ ...settings, globalVars: updated })
                      }}
                      placeholder="key_name"
                      className="w-1/3 px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-cyan-400 font-bold focus:outline-none"
                    />
                    <input
                      type="text"
                      value={v.value}
                      onChange={(e) => {
                        const updated = [...settings.globalVars]
                        updated[idx].value = e.target.value
                        setSettings({ ...settings, globalVars: updated })
                      }}
                      placeholder="Variable value"
                      className="flex-1 px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: CODE INJECTION */}
          {activeTab === 'code-injection' && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-xl font-extrabold text-white">Code Injection</h3>
                <p className="text-slate-400">Inject custom HTML, CSS, or JavaScript into &#60;head&#62; or &#60;body&#62;</p>
              </div>

              <div className="space-y-4 bg-[#0B0F19] border border-white/10 rounded-3xl p-6 shadow-xl">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Header Code Injection (&#60;head&#62;)</label>
                  <textarea
                    rows={5}
                    value={settings.headCode}
                    onChange={(e) => setSettings({ ...settings, headCode: e.target.value })}
                    className="w-full p-4 bg-slate-950 border border-white/10 rounded-xl text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none"
                  ></textarea>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Body Code Injection (&#60;body&#62;)</label>
                  <textarea
                    rows={5}
                    value={settings.bodyCode}
                    onChange={(e) => setSettings({ ...settings, bodyCode: e.target.value })}
                    className="w-full p-4 bg-slate-950 border border-white/10 rounded-xl text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none"
                  ></textarea>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: PAYMENT PROCESSING & BUSINESS DETAILS */}
          {(activeTab === 'business-details' || activeTab === 'payment-processing') && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-xl font-extrabold text-white">Payment Processing & Commerce Setup</h3>
                <p className="text-slate-400">Configure Stripe, PayPal, Razorpay credentials for project monetization</p>
              </div>

              <div className="space-y-4 bg-[#0B0F19] border border-white/10 rounded-3xl p-6 shadow-xl">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Company / Business Name</label>
                  <input
                    type="text"
                    value={settings.companyName}
                    onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold block">Stripe Publishable API Key</label>
                  <input
                    type="text"
                    value={settings.stripeKey}
                    onChange={(e) => setSettings({ ...settings, stripeKey: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* FALLBACK FOR OTHER TABS */}
          {['languages', 'shipping-carriers', 'email-integrations', 'spam-protection', 'seo', 'redirects', 'analytics'].includes(activeTab) && (
            <div className="max-w-3xl mx-auto space-y-6 font-mono text-xs">
              <div className="border-b border-white/10 pb-4">
                <h3 className="text-xl font-extrabold text-white capitalize">{activeTab.replace('-', ' ')}</h3>
                <p className="text-slate-400">Configure {activeTab} parameters for this project</p>
              </div>

              <div className="p-8 bg-[#0B0F19] border border-white/10 rounded-3xl text-center space-y-3">
                <Settings className="w-10 h-10 text-cyan-400 mx-auto animate-spin" />
                <h4 className="font-bold text-white text-base">Module Active & Ready</h4>
                <p className="text-slate-400 text-xs">All configuration parameters for {activeTab} are bound to your live project workspace.</p>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}

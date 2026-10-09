import React from 'react'
import AdminOverview from './admin/AdminOverview'
import AdminUsers from './admin/AdminUsers'
import AdminOrganizations from './admin/AdminOrganizations'
import AdminPlans from './admin/AdminPlans'
import AdminSettings from './admin/AdminSettings'
import AdminSupport from './admin/AdminSupport'
import { AdminServers, AdminSubscriptions, AdminAuditLog } from './admin/AdminRecords'

const PAGE_TITLES = {
  dashboard: ['Platform overview', 'Users, revenue and activity across every tenant'],
  users: ['Users', 'Create admin accounts, manage roles, suspend access and reset passwords'],
  organizations: ['Organizations', 'Tenant workspaces, their plans, members and resources'],
  servers: ['Servers', 'Every server connected to the platform'],
  subscriptions: ['Subscriptions', 'Plan assignments and billing periods'],
  support: ['Support tickets', 'Questions and issues raised by admins from their panel'],
  plans: ['Plans & pricing', 'Limits and prices offered to customers'],
  'audit-logs': ['Audit trail', 'Every sign-in and administrative action'],
  settings: ['Platform settings', 'Registration, maintenance mode and announcements']
}

export default function SuperAdminPortal({ activeTab = 'dashboard', apiBaseUrl = '', currentUser, onNavigate = () => {} }) {
  const [title, subtitle] = PAGE_TITLES[activeTab] || PAGE_TITLES.dashboard
  const props = { apiBaseUrl, currentUser, onNavigate }

  return (
    <div className="max-w-7xl mx-auto space-y-6 font-sans">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{title}</h1>
        <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
      </div>
      {activeTab === 'dashboard' && <AdminOverview {...props} />}
      {activeTab === 'users' && <AdminUsers {...props} />}
      {activeTab === 'organizations' && <AdminOrganizations {...props} />}
      {activeTab === 'servers' && <AdminServers {...props} />}
      {activeTab === 'subscriptions' && <AdminSubscriptions {...props} />}
      {activeTab === 'support' && <AdminSupport {...props} />}
      {activeTab === 'plans' && <AdminPlans {...props} />}
      {activeTab === 'audit-logs' && <AdminAuditLog {...props} />}
      {activeTab === 'settings' && <AdminSettings {...props} />}
    </div>
  )
}

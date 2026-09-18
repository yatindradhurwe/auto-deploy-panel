import React, { useState, useEffect } from 'react'
import { Users, UserPlus, Shield, Trash2, Mail, Check, Zap, AlertCircle } from 'lucide-react'

export default function TeamManager({ apiBaseUrl = '' }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'DEVELOPER' })
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const fetchMembers = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/team/members`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.members) setMembers(data.members)
    } catch (err) {
      console.error('Failed to fetch team members:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const handleInvite = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/team/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(inviteForm)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to invite team member.')

      setSuccessMsg(data.message)
      setShowInviteModal(false)
      setInviteForm({ email: '', role: 'DEVELOPER' })
      fetchMembers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRoleChange = async (userId, newRole) => {
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/team/members/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      })
      if (res.ok) fetchMembers()
    } catch (err) {
      alert('Role update failed: ' + err.message)
    }
  }

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Remove this member from your organization workspace?')) return
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/team/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) fetchMembers()
    } catch (err) {
      alert('Remove member failed: ' + err.message)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
        <div>
          <div className="flex items-center space-x-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Users className="w-4 h-4" />
            <span>Role-Based Access Control (RBAC)</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Team & Member Management</h1>
          <p className="text-xs text-slate-400 mt-1">Manage team access, permissions, and roles within your Organization</p>
        </div>

        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 flex items-center space-x-2 transition"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Member</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
          {successMsg}
        </div>
      )}

      {/* Members Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-4 px-6">Member</th>
              <th className="py-4 px-6">Email</th>
              <th className="py-4 px-6">Role</th>
              <th className="py-4 px-6">Joined Date</th>
              <th className="py-4 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs text-slate-200">
            {loading ? (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-400 font-mono">
                  Loading team members...
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-400">
                  No team members found. Invite your first team member!
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-4 px-6 font-semibold flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center font-bold text-white text-xs shadow">
                      {m.fullName?.charAt(0) || 'U'}
                    </div>
                    <span>{m.fullName}</span>
                  </td>
                  <td className="py-4 px-6 font-mono text-slate-400">{m.email}</td>
                  <td className="py-4 px-6">
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-cyan-300 font-semibold focus:outline-none focus:border-cyan-500"
                    >
                      <option value="OWNER">OWNER</option>
                      <option value="ADMIN">ADMIN</option>
                      <option value="DEVELOPER">DEVELOPER</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </td>
                  <td className="py-4 px-6 text-slate-400 font-mono text-[11px]">
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      className="p-1.5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-lg transition"
                      title="Remove Member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Invite Team Member</h3>
            <p className="text-xs text-slate-400 mb-5">Grant access to your organization dashboard and Code Studio</p>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold">User Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="developer@company.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-semibold">Role & Permissions</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ADMIN">ADMIN - Full Workspace Control</option>
                  <option value="DEVELOPER">DEVELOPER - Deploy & Code Access</option>
                  <option value="VIEWER">VIEWER - Read-Only Console</option>
                </select>
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

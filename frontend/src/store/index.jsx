import React from 'react'
import { ServersProvider } from './ServersContext'
import { ProjectsProvider } from './ProjectsContext'

export { AuthProvider, useAuth, PORTALS } from './AuthContext'
export { ServersProvider, useServers } from './ServersContext'
export { ProjectsProvider, useProjects, canManageProject, canShareProject, ACCESS_LABELS } from './ProjectsContext'

/**
 * State for the signed-in workspace: servers → projects (projects follow the selected server).
 * Mounted per user so switching accounts never shows the previous account's data.
 */
export function WorkspaceProvider({ children }) {
  return (
    <ServersProvider>
      <ProjectsProvider>{children}</ProjectsProvider>
    </ServersProvider>
  )
}

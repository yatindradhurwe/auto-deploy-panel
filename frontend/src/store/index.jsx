import React from 'react'
import { ServersProvider } from './ServersContext'
import { ProjectsProvider } from './ProjectsContext'
import { NavigationProvider } from './NavigationContext'

export { AuthProvider, useAuth, PORTALS } from './AuthContext'
export { ServersProvider, useServers } from './ServersContext'
export { NavigationProvider, useNavigation } from './NavigationContext'
export { ProjectsProvider, useProjects, canManageProject, canShareProject, ACCESS_LABELS } from './ProjectsContext'

/**
 * State for the signed-in workspace: servers → projects (projects follow the selected server),
 * plus where the panel is (screen, tab, open project), kept in the URL so a reload stays put.
 * Mounted per user so switching accounts never shows the previous account's data.
 */
export function WorkspaceProvider({ children }) {
  return (
    <ServersProvider>
      <ProjectsProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </ProjectsProvider>
    </ServersProvider>
  )
}

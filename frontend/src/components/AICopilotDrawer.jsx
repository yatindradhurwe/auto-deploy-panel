import React from 'react'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'

export default function AICopilotDrawer({ isOpen, onClose, logs, config, onAutoFixConfig }) {
  if (!isOpen) return null

  const targetPath = config?.remoteDir || config?.projectPath || '/var/www/auto-deploy-panel'
  const jwtToken = localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''

  return (
    <AIAgentStudioDrawer
      isOpen={isOpen}
      onClose={onClose}
      projectPath={targetPath}
      jwtToken={jwtToken}
    />
  )
}

import React from 'react'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'
import { useAuth } from '../store/AuthContext'

export default function AICopilotDrawer({ isOpen, onClose, logs, config, onAutoFixConfig }) {
  if (!isOpen) return null

  const targetPath = config?.remoteDir || config?.projectPath || '/var/www/auto-deploy-panel'
  const { token: jwtToken } = useAuth()

  return (
    <AIAgentStudioDrawer
      isOpen={isOpen}
      onClose={onClose}
      projectPath={targetPath}
    />
  )
}

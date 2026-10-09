import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './store/AuthContext'
import './index.css'
import { installServerHeader } from './utils/activeServer'
import { installSessionGuard } from './utils/session'

// Every API call goes to the server selected in the panel
installServerHeader()
// Return to the login screen as soon as the server ends the session
installSessionGuard()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)

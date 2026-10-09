import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installServerHeader } from './utils/activeServer'

// Every API call goes to the server selected in the panel
installServerHeader()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

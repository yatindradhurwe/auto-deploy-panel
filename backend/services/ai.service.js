import https from 'https'
import { Client } from 'ssh2'

/**
 * Heuristic rule-based DevOps log analyzer & fallback AI agent logic
 */
function analyzeDevOpsHeuristics(logsText, config) {
  const fixes = []
  let rootCause = 'Deployment process encountered an issue.'

  if (logsText.includes('fatal: could not read Username') || logsText.includes('exit code 128')) {
    rootCause = 'Git Clone / Authentication Failure. The target repository is Private or the Git URL is incorrect.'
    fixes.push({
      title: 'Use Authenticated Private Git URL',
      command: `echo "Private repo authentication fix needed in repository URL configuration"`,
      explanation: `Add your GitHub Personal Access Token into the Git URL: https://<TOKEN>@github.com/${config.gitRepoUrl ? config.gitRepoUrl.replace('https://github.com/', '') : 'user/repo.git'}`,
      isManualConfig: true
    })
  } else if (logsText.includes('No such file or directory') && logsText.includes('package.json')) {
    rootCause = 'Directory Layout Mismatch. Could not locate package.json in the expected directory.'
    fixes.push({
      title: 'Verify Directory Structure on Server',
      command: `ls -la ${config.remoteDir || '/var/www/app'}`,
      explanation: 'List files in project directory to inspect actual project files.'
    })
  } else if (logsText.includes('nginx: [emerg]') || logsText.includes('nginx.conf test failed')) {
    rootCause = 'Nginx Syntax Error in web server configuration.'
    fixes.push({
      title: 'Test and Reload Nginx',
      command: 'nginx -t && systemctl reload nginx',
      explanation: 'Validate Nginx configuration syntax and reload Nginx service.'
    })
  } else if (logsText.includes('EADDRINUSE') || logsText.includes('address already in use')) {
    rootCause = `Port ${config.backendPort || 5050} is already in use by another service on the server.`
    fixes.push({
      title: 'Kill conflicting process on port',
      command: `fuser -k ${config.backendPort || 5050}/tcp || true`,
      explanation: `Free port ${config.backendPort || 5050} before restarting backend service.`
    })
  } else {
    fixes.push({
      title: 'Check PM2 process logs on server',
      command: `pm2 logs ${config.appName || 'app'} --lines 50 --raw`,
      explanation: 'Fetch last 50 lines of PM2 application execution logs.'
    })
  }

  return {
    rootCause,
    explanation: 'The AI DevOps Agent analyzed the terminal execution logs and identified potential root causes.',
    suggestedFixes: fixes
  }
}

/**
 * REST API Caller for Multi-Provider AI Engine (Gemini, Grok, Claude, ChatGPT)
 */
export function callMultiProviderApi(provider, apiKey, promptText, systemInstruction = '') {
  return new Promise((resolve, reject) => {
    let hostname = ''
    let pathStr = ''
    let headers = { 'Content-Type': 'application/json' }
    let payload = ''

    if (provider === 'grok') {
      // xAI Grok API (OpenAI compatible format)
      hostname = 'api.x.ai'
      pathStr = '/v1/chat/completions'
      headers['Authorization'] = `Bearer ${apiKey}`
      payload = JSON.stringify({
        model: 'grok-beta',
        messages: [
          { role: 'system', content: systemInstruction || 'You are xAI Grok Autonomous Coding Agent.' },
          { role: 'user', content: promptText }
        ]
      })
    } else if (provider === 'claude') {
      // Anthropic Claude API
      hostname = 'api.anthropic.com'
      pathStr = '/v1/messages'
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      payload = JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: promptText }]
      })
    } else if (provider === 'chatgpt' || provider === 'openai') {
      // OpenAI ChatGPT API
      hostname = 'api.openai.com'
      pathStr = '/v1/chat/completions'
      headers['Authorization'] = `Bearer ${apiKey}`
      payload = JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemInstruction || 'You are OpenAI ChatGPT Autonomous Coding & DevOps Agent.' },
          { role: 'user', content: promptText }
        ]
      })
    } else {
      // Default: Google Gemini API
      hostname = 'generativelanguage.googleapis.com'
      pathStr = `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
      payload = JSON.stringify({
        contents: [{ parts: [{ text: `${systemInstruction ? systemInstruction + '\n\n' : ''}${promptText}` }] }]
      })
    }

    headers['Content-Length'] = Buffer.byteLength(payload)

    const req = https.request({ hostname, path: pathStr, method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          let reply = ''
          if (provider === 'grok' || provider === 'chatgpt' || provider === 'openai') {
            reply = parsed?.choices?.[0]?.message?.content
          } else if (provider === 'claude') {
            reply = parsed?.content?.[0]?.text
          } else {
            reply = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
          }

          if (reply) resolve(reply)
          else reject(new Error(parsed.error?.message || `${provider.toUpperCase()} API returned empty response`))
        } catch (e) {
          reject(new Error(`Invalid response structure from ${provider.toUpperCase()} API`))
        }
      })
    })

    req.on('error', (err) => reject(err))
    req.write(payload)
    req.end()
  })
}

/**
 * Main AI Copilot Diagnosis Handler
 */
export async function diagnoseDeploymentError(payload) {
  const { logs, config, userPrompt, apiKey, provider = 'gemini' } = payload
  const logsText = Array.isArray(logs) ? logs.map((l) => l.text).join('') : (logs || '')

  const systemPrompt = `You are an expert DevOps AI Agent specializing in Linux servers, Nginx, PM2, Node.js, React, Vite, Git, and SSL Let's Encrypt.
Analyze the following deployment configuration and terminal logs:

CONFIG:
- Target Domain: ${config.domain}
- Server IP: ${config.host}
- Remote Dir: ${config.remoteDir}
- App Name: ${config.appName}
- Backend Port: ${config.backendPort}
- Git Repo URL: ${config.gitRepoUrl}

TERMINAL LOGS:
${logsText.slice(-3000)}

${userPrompt ? `USER PROMPT: ${userPrompt}` : 'Task: Diagnose the root cause of the deployment failure and provide concise, step-by-step fix instructions and exact Linux SSH bash commands.'}

Respond in Markdown with clear headings:
### 🔍 Root Cause Analysis
### 💡 Recommended Fix Steps
### 🛠️ Bash Commands to Execute
`

  if (apiKey) {
    try {
      const aiReply = await callMultiProviderApi(provider, apiKey, systemPrompt)
      const heuristics = analyzeDevOpsHeuristics(logsText, config)
      return {
        success: true,
        aiDiagnosis: aiReply,
        heuristicDiagnosis: heuristics
      }
    } catch (err) {
      console.warn(`${provider} API call failed, falling back to heuristics:`, err.message)
    }
  }

  // Fallback to intelligent heuristics
  const heuristics = analyzeDevOpsHeuristics(logsText, config)
  return {
    success: true,
    aiDiagnosis: `### 🔍 Root Cause Analysis\n${heuristics.rootCause}\n\n### 💡 Recommended Fix Steps\n${heuristics.explanation}\n\n### 🛠️ Bash Commands to Execute\n\`\`\`bash\n${heuristics.suggestedFixes.map(f => f.command).join('\n')}\n\`\`\``,
    heuristicDiagnosis: heuristics
  }
}

/**
 * Connects to remote server via SSH and executes AI-suggested fix command
 */
export async function executeSshPatch(config, commandToRun) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const connConfig = {
      host: config.host,
      port: parseInt(config.port || 22, 10),
      username: config.username || 'root',
      readyTimeout: 15000,
    }

    if (config.privateKey) connConfig.privateKey = config.privateKey
    else connConfig.password = config.password

    conn.on('ready', () => {
      conn.exec(commandToRun, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }
        let stdout = ''
        let stderr = ''
        stream.on('data', (d) => { stdout += d.toString() })
        stream.stderr.on('data', (d) => { stderr += d.toString() })
        stream.on('close', (code) => {
          conn.end()
          resolve({
            success: code === 0,
            exitCode: code,
            stdout,
            stderr
          })
        })
      })
    })

    conn.on('error', (err) => reject(err))
    conn.connect(connConfig)
  })
}

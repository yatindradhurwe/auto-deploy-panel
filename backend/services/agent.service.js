import { getServersByOrgId, createServer, updateServer, getServerById, recordAuditLog } from './db.service.js'

/**
 * Register new customer VPS server from agent installer script
 */
export function registerAgentServer({ organizationId, token, hostname, ipAddress, os, cpu, ram, disk }) {
  if (!organizationId) {
    throw new Error('organizationId is required for agent registration.')
  }

  const orgServers = getServersByOrgId(organizationId)
  const existing = orgServers.find(s => s.agentToken === token || s.ipAddress === ipAddress)

  if (existing) {
    const updated = updateServer(existing.id, {
      hostname: hostname || existing.hostname,
      ipAddress: ipAddress || existing.ipAddress,
      os: os || existing.os,
      status: 'online',
      cpu: cpu || existing.cpu,
      ram: ram || existing.ram,
      disk: disk || existing.disk,
      lastSeen: new Date().toISOString()
    })
    return { server: updated, isNew: false }
  }

  const serverCount = orgServers.length + 1
  const server = createServer({
    organizationId,
    name: `VPS Node ${serverCount.toString().padStart(2, '0')} (${ipAddress})`,
    hostname: hostname || ipAddress,
    ipAddress: ipAddress || '127.0.0.1',
    os: os || 'Linux Ubuntu 22.04',
    agentToken: token,
    status: 'online',
    cpu: cpu || 0,
    ram: ram || 0,
    disk: disk || 0
  })

  recordAuditLog({
    organizationId,
    userId: 'system-agent',
    action: 'SERVER_REGISTERED',
    resourceType: 'server',
    resourceId: server.id,
    ip: ipAddress,
    details: { name: server.name, ip: ipAddress }
  })

  return { server, isNew: true }
}

/**
 * Handle recurring outbound heartbeat from client VPS agent node
 */
export function processAgentHeartbeat({ serverId, agentToken, metrics }) {
  const server = getServerById(serverId)
  if (!server) {
    throw new Error(`Server '${serverId}' not found.`)
  }

  if (server.agentToken && server.agentToken !== agentToken) {
    throw new Error('Invalid agent authentication token.')
  }

  const updated = updateServer(serverId, {
    status: 'online',
    cpu: metrics?.cpu ?? server.cpu,
    ram: metrics?.ram ?? server.ram,
    disk: metrics?.disk ?? server.disk,
    lastSeen: new Date().toISOString()
  })

  return updated
}

/**
 * Generate standard Linux Bash install script content served dynamically by `/install.sh`
 */
export function generateInstallScriptHtml(hostUrl = 'https://automate-deployment.yjtechnosoft.com') {
  return `#!/bin/bash
set -e

# ==============================================================================
# AutoDeploy Agent Installer Script
# Automated Outbound Node Setup for Ubuntu / Debian / RHEL / CentOS
# ==============================================================================

TOKEN=""
ORG_ID=""

for arg in "$@"
do
    case $arg in
        --token=*)
        TOKEN="\${arg#*=}"
        shift
        ;;
        --org=*)
        ORG_ID="\${arg#*=}"
        shift
        ;;
    esac
done

if [ -z "$TOKEN" ]; then
    echo "[ERROR] Missing --token argument!"
    echo "Usage: curl -fsSL ${hostUrl}/install.sh | sudo bash -s -- --token=YOUR_TOKEN --org=YOUR_ORG"
    exit 1
fi

echo "=================================================="
echo " Starting AutoDeploy Agent Node Setup..."
echo " Central Server: ${hostUrl}"
echo " Organization:   \${ORG_ID:-org-default}"
echo "=================================================="

# Check root privileges
if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run installer as root (e.g. sudo bash)."
  exit 1
fi

# Detect system IP
IP_ADDR=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
HOST_NAME=$(hostname)
OS_INFO=$(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || echo "Linux")

echo "--> System IP:       $IP_ADDR"
echo "--> Hostname:        $HOST_NAME"
echo "--> OS:              $OS_INFO"

# Install Docker, PM2, Git if missing
echo "--> Ensuring core dependencies (git, curl, nodejs, pm2, docker)..."
if ! command -v git &> /dev/null; then
    apt-get update -y && apt-get install -y git curl build-essential
fi

if ! command -v pm2 &> /dev/null; then
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
    npm install -g pm2
fi

# Register server node with central panel API
echo "--> Registering server node with AutoDeploy SaaS panel..."
RESPONSE=$(curl -s -X POST "${hostUrl}/api/agent/register" \\
  -H "Content-Type: application/json" \\
  -d '{
    "organizationId": "'"\${ORG_ID:-org-default}"'",
    "token": "'"\${TOKEN}"'",
    "hostname": "'"\${HOST_NAME}"'",
    "ipAddress": "'"\${IP_ADDR}"'",
    "os": "'"\${OS_INFO}"'"
  }')

echo "--> Agent Registration Response: $RESPONSE"

echo "=================================================="
echo " [SUCCESS] AutoDeploy Server Node Connected!"
echo " Node IP: $IP_ADDR"
echo " Central Panel: ${hostUrl}"
echo "=================================================="
`
}

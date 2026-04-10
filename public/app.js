// public/app.js — Elefunk Agent Console client
'use strict'

// ── State ─────────────────────────────────────────────────────────────────────

let connId      = null   // X-Conn-Id from first response; reused for timing tracking
let wsSocket    = null
let wsFrameCount = 0

// ── Logging helpers ───────────────────────────────────────────────────────────

function addLog (labelText, labelClass, bodyText, bodyClass) {
  const scroll = document.getElementById('log-scroll')

  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })

  const entry  = document.createElement('div')
  entry.className = 'log-entry'

  const labelEl = document.createElement('div')
  labelEl.className = `log-label ${labelClass}`
  labelEl.textContent = `${labelText}  [${ts}]`

  const bodyEl = document.createElement('pre')
  bodyEl.className = `log-body${bodyClass ? ' ' + bodyClass : ''}`
  bodyEl.textContent = bodyText

  entry.appendChild(labelEl)
  entry.appendChild(bodyEl)
  scroll.appendChild(entry)
  scroll.scrollTop = scroll.scrollHeight
}

const logSystem = (msg) => addLog('SYSTEM', 'system', msg, 'dim-text')
const logTool   = (name) => addLog(`TOOL › ${name}`, 'tool', '', '')
const logResult = (body) => addLog('RESULT', 'result', body)
const logWS     = (body) => addLog('STREAM', 'ws-msg', body)
const logError  = (msg)  => addLog('ERROR',  'error',  msg)

// ── Sidebar ───────────────────────────────────────────────────────────────────

function updateSidebar (data) {
  if (data.current_user !== undefined)
    document.getElementById('s-user').textContent     = data.current_user
  if (data.session_id !== undefined)
    document.getElementById('s-session').textContent  = data.session_id
  if (Array.isArray(data.permissions))
    document.getElementById('s-perms').textContent    = data.permissions.join(', ')
  if (data._tool !== undefined)
    document.getElementById('s-last-tool').textContent = data._tool
}

// ── Tool call ─────────────────────────────────────────────────────────────────

async function callTool (toolName, args) {
  // Disable buttons during in-flight request
  document.querySelectorAll('.tool-btn').forEach(b => b.disabled = true)

  addLog(`TOOL › ${toolName}`, 'tool', JSON.stringify(args || {}, null, 2))

  const headers = { 'Content-Type': 'application/json' }
  if (connId) headers['X-Conn-Id'] = connId

  let res
  try {
    res = await fetch('/mcp/tools/call', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ name: toolName, arguments: args || {}, id: Date.now() })
    })
  } catch (err) {
    logError(`Network error: ${err.message}`)
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false)
    return
  }

  // Capture connId from the first response so subsequent calls share timing state
  if (!connId) {
    connId = res.headers.get('X-Conn-Id')
  }

  // FLAG 1: X-Session-Token header is set here by the server.
  // app.js does NOT read or display it — players must find it in DevTools.
  // res.headers.get('X-Session-Token') → 'ivry-admin-oauth-9k2m-elefunk'

  let data
  try {
    data = await res.json()
  } catch (err) {
    logError('JSON parse error')
    document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false)
    return
  }

  // Unwrap MCP JSON-RPC envelope to get the inner tool result
  let toolResult = null
  if (data.result?.content?.[0]?.text) {
    try { toolResult = JSON.parse(data.result.content[0].text) } catch (_) {}
  }

  const display = toolResult || data
  logResult(JSON.stringify(display, null, 2))

  if (toolResult) {
    updateSidebar({ ...toolResult, _tool: toolName })
  }

  // FLAG 3: if the server emits debugTrace (timing window fired), persist it to
  // sessionStorage. Players discover the key in DevTools → Application → Session Storage.
  // No visible indicator is added — finding it is the challenge.
  if (toolResult?.debugTrace) {
    sessionStorage.setItem('mcp_debug_trace', toolResult.debugTrace)
  }

  document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false)
}

// ── Buttons ───────────────────────────────────────────────────────────────────

document.getElementById('btn-session-info').addEventListener('click', () =>
  callTool('session_info', {}))

document.getElementById('btn-token-inspect').addEventListener('click', () =>
  callTool('token_inspect', {}))

document.getElementById('btn-file-read').addEventListener('click', () =>
  callTool('file_read', { path: '/agent/config.json' }))

// ── Flag validator ────────────────────────────────────────────────────────────

async function submitFlag () {
  const input    = document.getElementById('flag-input')
  const resultEl = document.getElementById('flag-result')
  const flag     = input.value.trim()
  if (!flag) return

  resultEl.textContent = '…'
  resultEl.className   = ''

  try {
    const res  = await fetch('/api/validate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ flag })
    })
    const data = await res.json()
    resultEl.textContent = data.valid ? `✓  ${data.message}` : `✗  ${data.message}`
    resultEl.className   = data.valid ? 'valid' : 'invalid'
  } catch {
    resultEl.textContent = 'Validator unreachable'
    resultEl.className   = 'invalid'
  }
}

document.getElementById('flag-submit').addEventListener('click', submitFlag)
document.getElementById('flag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitFlag()
})

// ── WebSocket — FLAG 2 vector ─────────────────────────────────────────────────
// Frame 2 (1.5s after connect) carries sess_admin_c8f2e1b4 as session_id.
// Both frames are logged visibly so players can read them in the log pane OR
// in DevTools → Network → WS → Frames. The skill gate is computing the SHA-256.

function connectWebSocket () {
  const wsUrl  = `ws://${location.host}/mcp/stream`
  wsSocket     = new WebSocket(wsUrl)

  wsSocket.addEventListener('open', () => {
    document.getElementById('ws-dot').className      = 'connected'
    document.getElementById('ws-status').textContent = 'Live'
    logSystem('MCP stream connected · ws://localhost:3000/mcp/stream')
  })

  wsSocket.addEventListener('message', (evt) => {
    let msg
    try { msg = JSON.parse(evt.data) } catch (_) { return }

    wsFrameCount++
    document.getElementById('s-ws-frames').textContent = wsFrameCount

    logWS(JSON.stringify(msg, null, 2))
  })

  wsSocket.addEventListener('close', () => {
    document.getElementById('ws-dot').className      = 'disconnected'
    document.getElementById('ws-status').textContent = 'Disconnected'
  })

  wsSocket.addEventListener('error', () => {
    logError('WebSocket error — check server status')
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────

logSystem('Elefunk Agent Console initialised')
logSystem('Agent: elefunk-mcp-agent-01 · Protocol: MCP 2024-11-05 · Op: Ivory Chain')
connectWebSocket()

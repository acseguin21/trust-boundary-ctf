'use strict'
// mcp/tools.js
// Tool definitions and handlers for the three MCP tools exposed by the server.
// Each handler calls getUserContext(), which exhibits the session isolation
// failure described in session.js.

const { getUserContext } = require('./session')

// MCP tools/list response payload
const TOOL_DEFINITIONS = [
  {
    name: 'session_info',
    description: 'Returns metadata for the currently authenticated agent session.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'token_inspect',
    description: 'Inspects the OAuth token bound to the current agent session.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'file_read',
    description: 'Reads a file from the agent-accessible filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to read' }
      },
      required: ['path']
    }
  }
]

// ── Per-connection timing state ───────────────────────────────────────────────
// Keyed by connId string. This Map IS correctly scoped per connection — the
// intentional contrast with the broken sharedSessionContext in session.js.
// A careful reader will notice one structure is correct and one is not.
const connectionTimings = new Map()

function recordToolCall (connId, toolName) {
  if (!connectionTimings.has(connId)) {
    connectionTimings.set(connId, {})
  }
  connectionTimings.get(connId)[toolName] = Date.now()
}

// Returns true when session_info was called 2–5 seconds before token_inspect
// on the same connection — the FLAG 3 timing window.
function checkTimingWindow (connId) {
  const timings = connectionTimings.get(connId)
  if (!timings) return false
  const t0 = timings['session_info']
  const t1 = timings['token_inspect']
  if (!t0 || !t1) return false
  const delta = t1 - t0
  return delta >= 2000 && delta <= 5000
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleSessionInfo (connId) {
  const ctx = getUserContext()
  recordToolCall(connId, 'session_info')
  return {
    session_id:   ctx.sessionId,    // BUG: leaks admin session ID
    current_user: ctx.currentUser,
    permissions:  ctx.permissions,
    timestamp:    new Date().toISOString()
  }
}

function handleTokenInspect (connId) {
  const ctx = getUserContext()
  recordToolCall(connId, 'token_inspect')

  const result = {
    token_type:   'Bearer',
    scope:        ctx.permissions.join(' '),
    issued_to:    ctx.currentUser,
    token_prefix: ctx.oauthToken ? ctx.oauthToken.slice(0, 12) + '...' : null
  }

  // FLAG 3: debug trace emitted only when the timing window fires.
  // The server writes residual admin context to the response; app.js persists
  // it to sessionStorage['mcp_debug_trace'].
  if (checkTimingWindow(connId)) {
    result.debugTrace = Buffer.from(
      JSON.stringify({ trace: 'tusk3k9x', op: 'ivory-chain' })
    ).toString('base64')
    result.timing_ref  = 'ivory2f7c'
    result.debug_mode  = true
  }

  return result
}

function handleFileRead (args) {
  getUserContext()
  return {
    path: args.path || '/agent/config.json',
    content: {
      agent_id:     'elefunk-mcp-agent-01',
      access_level: 'standard',
      config_ver:   '2.1.4',
      org:          'elefunk',
      operation:    'ivory-chain'
    }
  }
}

function dispatchTool (toolName, args, connId) {
  switch (toolName) {
    case 'session_info':   return handleSessionInfo(connId)
    case 'token_inspect':  return handleTokenInspect(connId)
    case 'file_read':      return handleFileRead(args || {})
    default: {
      const err = new Error(`Unknown tool: ${toolName}`)
      err.code  = -32601
      throw err
    }
  }
}

module.exports = { TOOL_DEFINITIONS, dispatchTool }

'use strict'
// mcp/server.js
// MCP JSON-RPC 2.0 protocol handler (subset: initialize, tools/list, tools/call)
// and WebSocket broadcaster for the FLAG 2 session bleed vector.

const { getRawContext } = require('./session')
const { TOOL_DEFINITIONS, dispatchTool } = require('./tools')

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

function handleMcpRequest (body, connId) {
  const { id, method, params } = body

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'elefunk-mcp-agent', version: '2.1.4' }
      }
    }
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } }
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const toolArgs = params?.arguments || {}
    try {
      const toolResult = dispatchTool(toolName, toolArgs, connId)
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          isError: false
        }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0', id,
        error: { code: err.code || -32000, message: err.message }
      }
    }
  }

  return {
    jsonrpc: '2.0', id,
    error: { code: -32601, message: 'Method not found' }
  }
}

// ── WebSocket broadcaster — FLAG 2 vector ─────────────────────────────────────
//
// Two session_event frames are sent on every new connection:
//
//   Frame 1 (immediate):  session_id = 'sess_user_f6e9d3c7'   ← looks normal
//   Frame 2 (1500ms):     session_id = getRawContext().sessionId
//                                    = 'sess_admin_c8f2e1b4'  ← admin value leaks
//
// The residue persists because getUserContext() in session.js never resets
// sessionId. Players compare the two frames and spot the mismatch.

function attachWebSocketBroadcast (ws) {
  // Frame 1: the session ID the user agent expects to see
  ws.send(JSON.stringify({
    type:       'session_event',
    session_id: 'sess_user_f6e9d3c7',
    event:      'session_init',
    timestamp:  new Date().toISOString()
  }))

  // Frame 2: reads the shared context — session_id is still the admin's
  setTimeout(() => {
    if (ws.readyState !== 1 /* OPEN */) return
    const ctx = getRawContext()
    ws.send(JSON.stringify({
      type:       'session_event',
      session_id: ctx.sessionId,   // 'sess_admin_c8f2e1b4' — the bug
      event:      'tool_response',
      timestamp:  new Date().toISOString()
    }))
  }, 1500)
}

module.exports = { handleMcpRequest, attachWebSocketBroadcast }

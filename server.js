'use strict'
// server.js — Elefunk Agent Console · trust-boundary-ctf
//
// Single Express process:
//   - Serves static UI from /public
//   - MCP JSON-RPC endpoint at POST /mcp/tools/call  (FLAG 1: X-Session-Token header)
//   - WebSocket stream at ws://localhost:3000/mcp/stream  (FLAG 2: session bleed)
//   - Flag validator at POST /api/validate
//   - Health check at GET /api/health

const path    = require('path')
const crypto  = require('crypto')
const express = require('express')
const http    = require('http')
const { WebSocketServer } = require('ws')

const { initAdminSession, getUserContext } = require('./mcp/session')
const { handleMcpRequest, attachWebSocketBroadcast } = require('./mcp/server')
const { validateFlag } = require('./flags/validator')

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// Populate the shared session context with admin credentials at startup.
// This is the precondition for the session bleed — getUserContext() will never
// fully overwrite these values.
initAdminSession()

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server, path: '/mcp/stream' })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── connId helper ─────────────────────────────────────────────────────────────
// Each connection gets a short random ID so tool timing can be tracked
// per-connection in mcp/tools.js without cookies or sessions.

function makeConnId () {
  return crypto.randomBytes(4).toString('hex')
}

// ── MCP tools/call — FLAG 1 vector ───────────────────────────────────────────
// X-Session-Token is set to context.oauthToken on every response.
// Because getUserContext() never resets oauthToken, it is always the admin's.

app.post('/mcp/tools/call', (req, res) => {
  const connId = req.headers['x-conn-id'] || makeConnId()
  const ctx    = getUserContext()  // triggers the bug: shared object, admin token leaks

  // FLAG 1: this header always carries the admin OAuth token
  res.setHeader('X-Session-Token', ctx.oauthToken)
  res.setHeader('X-Conn-Id', connId)
  res.setHeader('X-MCP-Session-Id', ctx.sessionId)

  // Map the simple { name, arguments } body to the MCP JSON-RPC envelope
  const body   = req.body
  const result = handleMcpRequest(
    { jsonrpc: '2.0', id: body.id || 1, method: 'tools/call', params: body },
    connId
  )
  res.json(result)
})

// MCP tools/list (GET convenience endpoint)
app.get('/mcp/tools', (req, res) => {
  const result = handleMcpRequest(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    'list'
  )
  res.json(result)
})

// Generic MCP JSON-RPC endpoint (initialize, etc.)
app.post('/mcp', (req, res) => {
  const connId = req.headers['x-conn-id'] || makeConnId()
  const ctx    = getUserContext()
  res.setHeader('X-Session-Token', ctx.oauthToken)
  res.setHeader('X-Conn-Id', connId)
  res.json(handleMcpRequest(req.body, connId))
})

// ── Flag validator ────────────────────────────────────────────────────────────

app.post('/api/validate', (req, res) => {
  const { flag } = req.body
  if (typeof flag !== 'string' || flag.length > 200) {
    return res.status(400).json({ valid: false, message: 'Invalid input' })
  }
  res.json(validateFlag(flag))
})

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', server: 'elefunk-mcp-agent', version: '2.1.4' })
})

// ── WebSocket — FLAG 2 vector ─────────────────────────────────────────────────

wss.on('connection', (ws) => {
  attachWebSocketBroadcast(ws)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'ack', ref: msg.id || null }))
      }
    } catch (_) {}
  })
  ws.on('error', () => {})
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
  const C = '\x1b[96m'   // cyan
  const D = '\x1b[2m'    // dim
  const R = '\x1b[0m'    // reset
  const G = '\x1b[92m'   // green

  console.log(`${C}`)
  console.log('  ╔══════════════════════════════════════════════════╗')
  console.log('  ║  🐘  ELEFUNK AGENT CONSOLE  ·  CTF LAB ACTIVE   ║')
  console.log('  ║      Operation: Ivory Chain                      ║')
  console.log(`  ╚══════════════════════════════════════════════════╝${R}`)
  console.log(`  ${G}●${R} ${D}UI:     ${R}http://localhost:${PORT}`)
  console.log(`  ${G}●${R} ${D}MCP:    ${R}POST http://localhost:${PORT}/mcp/tools/call`)
  console.log(`  ${G}●${R} ${D}Stream: ${R}ws://localhost:${PORT}/mcp/stream`)
  console.log()
})

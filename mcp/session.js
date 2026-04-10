'use strict'
// mcp/session.js
// ─────────────────────────────────────────────────────────────────────────────
// VULNERABLE BY DESIGN — CVE-2025-49596 pattern
//
// In a correctly implemented MCP server, each request lifecycle creates an
// isolated context object scoped to the session or request. Here a single
// module-level object is mutated by every call, causing cross-request data
// leakage — specifically, admin OAuth tokens and session IDs bleeding into
// user-scoped tool call responses.
//
// This is the real confused deputy pattern. The server never errors. Everything
// appears to succeed. The confusion is silent.
// ─────────────────────────────────────────────────────────────────────────────

// THE BUG: one shared mutable object for the entire process lifetime.
// Any call that mutates a subset of fields leaves stale values from previous
// callers in the remaining fields.
const sharedSessionContext = {
  currentUser: null,
  oauthToken: null,
  sessionId: null,
  permissions: []
}

// Called once at server start. Populates ALL fields with admin credentials.
function initAdminSession () {
  sharedSessionContext.currentUser = 'admin'
  sharedSessionContext.oauthToken  = 'ivry-admin-oauth-9k2m-elefunk'
  sharedSessionContext.sessionId   = 'sess_admin_c8f2e1b4'
  sharedSessionContext.permissions = ['read', 'write', 'admin', 'token_inspect']
}

// Called on each user request. Intentionally updates ONLY currentUser and
// permissions. The oauthToken and sessionId fields are never reset, so they
// silently retain the admin values set by initAdminSession().
//
// The fix (shown in SOLUTION.md) is to scope context per-request:
//   function getUserContext() {
//     return {
//       currentUser: 'user',
//       oauthToken:  USER_OAUTH_TOKEN,
//       sessionId:   'sess_user_' + generateId(),
//       permissions: ['read']
//     }
//   }
function getUserContext () {
  sharedSessionContext.currentUser = 'user'
  sharedSessionContext.permissions = ['read']
  // BUG: missing:
  //   sharedSessionContext.oauthToken = 'ivry-user-oauth-' + generateUserToken()
  //   sharedSessionContext.sessionId  = 'sess_user_' + generateSessionId()
  return sharedSessionContext  // caller receives the shared object — admin token and sessionId leak
}

// Returns the raw shared context without any mutation.
// Used by the WebSocket broadcaster to emit the post-mutation residual state.
function getRawContext () {
  return sharedSessionContext
}

module.exports = { initAdminSession, getUserContext, getRawContext }

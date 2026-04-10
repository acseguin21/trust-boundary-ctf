# SPOILERS.md — Trust Boundary CTF

> **This file is for purple teamers, instructors, and walkthrough demos.**  
> If you are here to play the CTF, close this file and open the console at `http://localhost:3000`.

This document is intended for:
- **Purple team exercises** where the defender walkthrough is part of the session
- **Instructor-led demos** where the vulnerability needs to be explained in real time
- **Detection engineering teams** building rules against this pattern before running the CTF blind

---

## The Vulnerability in Plain English

The MCP server creates one context object at startup — populated with admin credentials — and reuses it across every request. When a user tool call arrives, the server updates two fields (`currentUser`, `permissions`) but never resets `oauthToken` or `sessionId`. Those admin values persist silently in every response.

The server never throws an error. The UI reports "Session Active" throughout. The confusion is invisible unless you know where to look.

**The bug is in `mcp/session.js`:**

```js
// Called on each user request — only resets currentUser and permissions
function getUserContext () {
  sharedSessionContext.currentUser = 'user'
  sharedSessionContext.permissions = ['read']
  // BUG: oauthToken and sessionId are never reset
  // They still hold the admin values from initAdminSession()
  return sharedSessionContext
}
```

**The fix:** create a fresh context object per request instead of mutating a shared one. See the diff at the bottom of this file.

---

## Walkthrough

### FLAG 1 — `CTF{header_token_ivry-adm}`

**Location:** DevTools → Network → Response Headers

Every tool call returns an `X-Session-Token` response header. Because `getUserContext()` never resets `oauthToken`, the header always contains the admin OAuth token: `ivry-admin-oauth-9k2m-elefunk`. The flag is `CTF{header_token_` + the first 8 characters of that value.

```
ivry-admin-oauth-9k2m-elefunk
^^^^^^^^
ivry-adm

FLAG 1: CTF{header_token_ivry-adm}
```

**Demo talking point:** This is the real CVE-2025-49596 primitive. Defenders should alert on admin-prefixed tokens appearing in user-context HTTP responses.

---

### FLAG 2 — `CTF{confused_deputy_a7172eca6b1cde1c}`

**Location:** DevTools → Network → WS → Frames

Two `session_event` WebSocket frames fire on every page load. Frame 1 carries a plausible user session ID (`sess_user_f6e9d3c7`). Frame 2, sent 1.5 seconds later, reads from the shared context and leaks the admin session ID (`sess_admin_c8f2e1b4`).

The flag is `CTF{confused_deputy_` + the first 16 hex chars of `sha256('sess_admin_c8f2e1b4')`.

```js
// In DevTools console:
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sess_admin_c8f2e1b4'))
const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('')
console.log(hex.slice(0, 16))  // → a7172eca6b1cde1c

FLAG 2: CTF{confused_deputy_a7172eca6b1cde1c}
```

**Demo talking point:** This is the WebSocket session bleed described in CVE-2025-49596. Two frames, same connection, different identity contexts — the mismatch is the tell.

---

### FLAG 3 — `CTF{timing_window_tusk3k9x_ivory2f7c}`

**Location:** DevTools → Application → Session Storage → http://localhost:3000

The timing window opens when `session_info` is called and then `token_inspect` is called 2–5 seconds later on the same connection.

**Trigger sequence:**
1. Click **Inspect Session**
2. Wait 2–5 seconds
3. Click **Inspect Token**

When the window fires, the `token_inspect` response includes a `debugTrace` (base64) and a `timing_ref` field. The client silently writes `debugTrace` to `sessionStorage['mcp_debug_trace']`.

```js
// In DevTools → Application → Session Storage → http://localhost:3000
// Key: mcp_debug_trace

JSON.parse(atob(sessionStorage.mcp_debug_trace))
// → { trace: 'tusk3k9x', op: 'ivory-chain' }
// fragment1 = trace value = 'tusk3k9x'

// fragment2 = timing_ref from the token_inspect network response body = 'ivory2f7c'

FLAG 3: CTF{timing_window_tusk3k9x_ivory2f7c}
```

**Demo talking point:** This simulates the ~400ms race window in the original CVE. The 2-second delay is deliberately widened for reproducibility without HAR timing analysis. In production this window is much shorter — which is why automated detection matters more than manual observation.

---

## The Fix

```diff
-// One process-level object mutated by every call
-const sharedSessionContext = { currentUser: null, oauthToken: null, sessionId: null, permissions: [] }
-
-function initAdminSession () {
-  sharedSessionContext.oauthToken  = 'ivry-admin-oauth-9k2m-elefunk'
-  sharedSessionContext.sessionId   = 'sess_admin_c8f2e1b4'
-  sharedSessionContext.currentUser = 'admin'
-  sharedSessionContext.permissions = ['read', 'write', 'admin', 'token_inspect']
-}
-
-function getUserContext () {
-  sharedSessionContext.currentUser = 'user'
-  sharedSessionContext.permissions = ['read']
-  return sharedSessionContext  // admin token and sessionId still present
-}
+const crypto = require('crypto')
+
+// Each call returns a fresh isolated object — no shared mutable state
+function getUserContext () {
+  return {
+    currentUser: 'user',
+    oauthToken:  'ivry-user-oauth-' + crypto.randomBytes(8).toString('hex'),
+    sessionId:   'sess_user_'       + crypto.randomBytes(4).toString('hex'),
+    permissions: ['read']
+  }
+}
```

The rule: **context objects that carry credentials must be created fresh per request**, not derived by partial mutation of a shared baseline.

---

## Detection Rules (Production)

### KQL — Microsoft Sentinel

```kql
McpServerLogs
| where ResponseHeaders contains "X-Session-Token"
| extend token = extract("X-Session-Token: ([^\r\n]+)", 1, ResponseHeaders)
| where token contains "admin" and CallerContext == "user"
| project TimeGenerated, CallerContext, token, RequestPath, ClientIP
```

### Splunk SPL

```splunk
index=mcp_logs sourcetype=mcp_server_access
| rex field=response_headers "X-Session-Token: (?<session_token>[^\r\n]+)"
| where caller_context="user" AND match(session_token, "admin")
| table _time src_ip caller_context session_token request_path
```

### Sigma

```yaml
title: MCP Session Token Confusion — Admin Credential in User Context
id: e7c3f2a1-4b5d-4e8f-9c0a-1d2e3f4a5b6c
status: stable
description: Admin OAuth token in user-scoped MCP tool call response (CVE-2025-49596 pattern)
logsource:
  category: webserver
detection:
  selection:
    cs-uri-stem: '/mcp/tools/call'
    sc-status: 200
    response_header|contains|all:
      - 'X-Session-Token'
      - 'admin'
  caller:
    caller_context: 'user'
  condition: selection and caller
level: high
tags:
  - attack.credential_access
  - attack.t1528
```

---

## References

- CVE-2025-49596 — MCP OAuth token confusion via shared session context
- OWASP MCP Top 10 2025 — MCP01: Token Mismanagement
- [Model Context Protocol specification](https://spec.modelcontextprotocol.io)

---

*Swadee Security · Operation: Ivory Chain*

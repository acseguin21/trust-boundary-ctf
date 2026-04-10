# Trust Boundary: MCP Session Isolation CTF

**Trust Boundary** is a browser-based capture-the-flag lab where players investigate a live MCP server that silently leaks admin credentials into user-scoped tool call responses — the CVE-2025-49596 pattern in running code.

## Core Concept

The scenario places you as an Elefunk SOC analyst responding to an anomaly alert on `elefunk-mcp-agent-01`. The internal agent console looks normal — every tool call succeeds, the status bar reads "Session Active." But the session isolation is broken. Your mission is to find three hidden flags using only your browser's DevTools. No source reading required.

## The Vulnerability

The MCP server creates one context object at startup — populated with admin OAuth credentials — and reuses it across all requests. When a user tool call arrives, the server partially updates the context but never resets the token or session ID. Admin values bleed silently into user responses. The server never errors.

This is a real implementation of the confused deputy pattern described in CVE-2025-49596 and OWASP MCP Top 10 2025 (MCP01: Token Mismanagement).

## Three-Flag Mission

| # | Difficulty | Where | Trigger |
|---|-----------|-------|---------|
| FLAG 1 | Easy | Network → Response Headers | Any tool call |
| FLAG 2 | Medium | Network → WS → Frames | Page load |
| FLAG 3 | Hard | Application → Session Storage | Specific sequence + timing |

All flags follow the format `CTF{...}`. Submit each using the validator at the bottom of the console.

## Setup

**Requirements:** Node.js 18+. No Docker, no env vars, no config.

```bash
git clone https://github.com/acseguin21/trust-boundary-ctf
cd trust-boundary-ctf
npm install
npm start
```

Open **http://localhost:3000**

## Purple Team Use

`SPOILERS.md` contains the full walkthrough, flag derivations, the vulnerable code annotated, the fix as a diff, and detection rules in KQL, Splunk SPL, and Sigma format. It is intended for instructors, detection engineers, and purple team sessions where the vulnerability explanation is part of the exercise.

## Detection Rules

The lab includes production-ready detection rules for the session isolation failure pattern:

- **KQL** — Microsoft Sentinel / Defender XDR
- **Splunk SPL** — SIEM correlation
- **Sigma** — portable rule format

See `SPOILERS.md` for the full rule set.

## References

- CVE-2025-49596 — MCP OAuth token confusion via shared session context
- OWASP MCP Top 10 2025 — MCP01: Token Mismanagement
- [Model Context Protocol specification](https://spec.modelcontextprotocol.io)

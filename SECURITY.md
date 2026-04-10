# Security Policy

## Intended Use

Trust Boundary is a deliberately vulnerable application built for authorized security education, CTF events, and purple team exercises.

**Run it locally only.** Do not expose the server to a network. The vulnerability is real — the admin OAuth token leaks on every request by design.

## Scope

This project contains intentional security vulnerabilities. They are features, not bugs. Please do not file vulnerability reports for:

- Session isolation failures in `mcp/session.js`
- OAuth token leakage in HTTP response headers
- WebSocket session bleed
- Anything described in `SPOILERS.md`

## Reporting Unintended Issues

If you find a security issue outside the intentional vulnerability surface (e.g., a dependency with a known CVE that introduces unintended RCE), please report it privately:

**Email:** security@swadeesecurity.com

We will respond within 5 business days.

## Deployment Warning

This application **must not** be deployed to a public-facing server. It is designed exclusively for local, isolated lab use. Running it in a shared environment exposes real credentials (even though they are synthetic) and may mislead monitoring systems.

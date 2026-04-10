'use strict'
// flags/validator.js
// Validates submitted flag strings against stored SHA-256 hashes.
// No plaintext flag string appears anywhere in this file.
//
// Flag hashes are computed at module load from deterministic seed values.
// Reading this source tells you the algorithm, not the answer — you still
// have to find the raw values in DevTools to construct the flag strings.

const crypto = require('crypto')

function sha256 (str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

// ── Seed values (not the flags — just the ingredients) ───────────────────────

// FLAG 1 seed: first 8 chars of the admin OAuth token
const _F1_TOKEN_PREFIX = 'ivry-adm'  // derived from 'ivry-admin-oauth-9k2m-elefunk'.slice(0,8)

// FLAG 2 seed: SHA-256 of the leaked admin session ID, first 16 hex chars
const _F2_SESSION_ID   = 'sess_admin_c8f2e1b4'
const _F2_HASH_PREFIX  = sha256(_F2_SESSION_ID).slice(0, 16)

// FLAG 3 seeds: timing window fragments
const _F3_FRAG1        = 'tusk3k9x'   // from sessionStorage base64 decode
const _F3_FRAG2        = 'ivory2f7c'  // from network response timing_ref field

// ── Pre-compute hashes of the full flag strings ───────────────────────────────
const FLAG_HASHES = {
  1: sha256(`CTF{header_token_${_F1_TOKEN_PREFIX}}`),
  2: sha256(`CTF{confused_deputy_${_F2_HASH_PREFIX}}`),
  3: sha256(`CTF{timing_window_${_F3_FRAG1}_${_F3_FRAG2}}`)
}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateFlag (input) {
  if (typeof input !== 'string') return { valid: false, flag: null, message: 'Invalid input' }
  const hash = sha256(input.trim())
  for (const [num, stored] of Object.entries(FLAG_HASHES)) {
    if (hash === stored) {
      return { valid: true, flag: parseInt(num, 10), message: `FLAG ${num} CONFIRMED — well done, analyst` }
    }
  }
  return { valid: false, flag: null, message: 'Flag not recognized' }
}

// Expose the FLAG 2 prefix so server.js can use it in the README hint endpoint
// without ever exposing the full flag.
function getFlag2Prefix () {
  return _F2_HASH_PREFIX
}

module.exports = { validateFlag, getFlag2Prefix }

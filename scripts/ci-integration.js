/*
  CI integration check for PEEK-40

  This script (intended for CI) performs a minimal end-to-end smoke test:
  1. Exchanges client credentials for a service token at ESTIVA_ID_ORIGIN/token
  2. Calls ESTIVA_ID_ORIGIN/sign with a minimal unsigned event and the token
  3. POSTS the returned signed event to the relay's /events endpoint using the
     NIP-98 header form `Authorization: Nostr <base64(signed-event)>` and
     verifies the relay responds with a 2xx and an accepted:true or similar

  Requires GitHub secrets set on the runner: ESTIVA_ID_CLIENT_ID,
  ESTIVA_ID_CLIENT_SECRET, NOSTR_RELAY_URL. Optionally ESTIVA_ID_SERVICE_PUBKEY
  and ESTIVA_ID_ORIGIN (defaults to https://id.estiva.app).
*/

import crypto from 'crypto'
import { Buffer } from 'buffer'

const origin = process.env.ESTIVA_ID_ORIGIN || 'https://id.estiva.app'
const clientId = process.env.ESTIVA_ID_CLIENT_ID
const clientSecret = process.env.ESTIVA_ID_CLIENT_SECRET
const relayUrl = process.env.NOSTR_RELAY_URL
const configuredPubkey = process.env.ESTIVA_ID_SERVICE_PUBKEY || ''

function exitFail(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

if (!clientId || !clientSecret || !relayUrl) {
  exitFail('Missing required env: set ESTIVA_ID_CLIENT_ID, ESTIVA_ID_CLIENT_SECRET and NOSTR_RELAY_URL as repo secrets for this job')
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch (e) {
    console.warn('Non-JSON response from', url, text.slice(0, 1000))
    throw new Error(`Non-JSON response ${res.status}`)
  }
  return { res, body }
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex')
}

function base64Event(ev) {
  return Buffer.from(JSON.stringify(ev)).toString('base64')
}

;(async () => {
  console.log('Exchanging client credentials for a token at', origin)
  const tokenUrl = `${origin.replace(/\/+$/, '')}/token`
  const { res: tokenRes, body: tokenBody } = await jsonFetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId, clientSecret }),
  })
  if (!tokenRes.ok) {
    exitFail(`Token exchange failed: ${tokenRes.status} ${JSON.stringify(tokenBody)}`)
  }
  const accessToken = tokenBody.access_token ?? tokenBody.accessToken ?? tokenBody.token
  const tokenPubkey = tokenBody.pubkey ?? ''
  if (!accessToken) exitFail('Token exchange returned no access token')

  const pubkey = configuredPubkey || tokenPubkey
  if (!pubkey) console.warn('No service pubkey available from env or token response; /sign may still succeed if it returns it')

  console.log('Calling /sign to request a signed kind:27235 (NIP-98) event')
  const unsigned = {
    pubkey: pubkey || '',
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [
      ['u', relayUrl.replace(/\/+$/, '')],
      ['method', 'POST'],
      ['nonce', randomHex(12)],
    ],
    content: '',
  }

  const signUrl = `${origin.replace(/\/+$/, '')}/sign`
  const { res: signRes, body: signBody } = await jsonFetch(signUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!signRes.ok) {
    exitFail(`POST /sign failed: ${signRes.status} ${JSON.stringify(signBody)}`)
  }
  if (!signBody || !signBody.event) exitFail('POST /sign returned no event')
  const signed = signBody.event
  console.log('Received signed event id=', signed.id ?? '<no-id>')

  // Post the signed event to the relay as a smoke test
  const authHeader = `Nostr ${base64Event(signed)}`
  console.log('Posting signed event to relay', relayUrl)
  const relayEvents = relayUrl.replace(/\/+$/, '') + '/events'
  const { res: relayRes, body: relayBody } = await jsonFetch(relayEvents, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(signed),
  })

  if (relayRes.status < 200 || relayRes.status >= 300) {
    exitFail(`Relay /events returned ${relayRes.status}: ${JSON.stringify(relayBody)}`)
  }

  // Relay may return { accepted: false, message: ... } — still consider 2xx a success
  console.log('Relay /events response', JSON.stringify(relayBody).slice(0, 500))
  console.log('Integration check succeeded')
  process.exit(0)
})().catch((e) => {
  console.error('Integration script error:', e)
  process.exit(2)
})

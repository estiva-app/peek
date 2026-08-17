/**
 * Sign into Peek headlessly, using a CDP virtual authenticator.
 *
 * Peek has no password screen since PEEK-41 — the only way in is the Estiva ID
 * passkey redirect, which a headless browser cannot satisfy on its own. Chrome
 * DevTools Protocol can install a *software* authenticator that answers WebAuthn
 * ceremonies automatically, which is how Estiva ID's own tests drive this.
 *
 * Usage:
 *
 *   import { signedInPage } from './scripts/signedIn.mjs'
 *   const { browser, page, pubkey } = await signedInPage()
 *   await page.goto('http://localhost:5173/topics')
 *   ...
 *   await browser.close()
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAFETY — read before changing the guard below.
 *
 * A virtual authenticator is not itself dangerous: it is additive, scoped to one
 * browser instance, and cannot read or exfiltrate real credentials. The platform
 * authenticator (Windows Hello, hardware keys) is untouched.
 *
 * The risk is *which identity service you point it at*. Registering against a
 * real deployment creates a REAL credential server-side whose private key lives
 * only in a throwaway browser profile — an orphan that can never be used again
 * and is indistinguishable from a genuine device in the account's key list.
 *
 * So this refuses to run against a production origin unless someone opts in
 * explicitly. Point it at a local Estiva ID instead:
 *
 *   VITE_ESTIVA_ID_ORIGIN=http://localhost:8787 npm run dev
 *
 * (estiva-id lives at ../estiva-id; `docker compose up` there brings up its
 * Postgres, and `PEEK_REDIRECT_URIS` must include http://localhost:5173/auth/callback.)
 */
import { chromium } from 'playwright-core'

/** Origins that hold real people's credentials. Never auto-register here. */
const PRODUCTION_ORIGINS = ['https://id.estiva.app']

export const APP_ORIGIN = process.env.PEEK_APP_ORIGIN ?? 'http://localhost:5173'
export const ESTIVA_ID_ORIGIN = process.env.VITE_ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'

function assertSafeTarget() {
  const isProd = PRODUCTION_ORIGINS.includes(ESTIVA_ID_ORIGIN.replace(/\/$/, ''))
  if (isProd && process.env.PEEK_VERIFY_ALLOW_PROD !== '1') {
    throw new Error(
      `Refusing to register a virtual authenticator against ${ESTIVA_ID_ORIGIN}.\n` +
        `That is a production identity service; a test passkey there becomes a real,\n` +
        `permanently-unusable credential on a real account.\n\n` +
        `Run a local Estiva ID and set VITE_ESTIVA_ID_ORIGIN for BOTH the dev server\n` +
        `and this script, or set PEEK_VERIFY_ALLOW_PROD=1 if you genuinely mean it.`,
    )
  }
  return isProd
}

/**
 * Launch a browser whose WebAuthn ceremonies complete on their own.
 *
 * `automaticPresenceSimulation` answers the "touch your key" prompt; without it
 * the ceremony hangs forever in headless. `isUserVerified` satisfies the
 * user-verification requirement a passkey login asks for, and `hasResidentKey`
 * makes the credential discoverable, which is what lets Estiva ID offer a
 * usernameless sign-in rather than asking who you are first.
 */
async function installVirtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number}  [opts.timeout=60000] ms to wait for the round trip to settle
 * @returns {Promise<{browser, context, page, pubkey: string|null, authenticatorId: string}>}
 */
export async function signedInPage(opts = {}) {
  const { headless = true, timeout = 60_000 } = opts
  assertSafeTarget()

  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  const page = await context.newPage()

  const { cdp, authenticatorId } = await installVirtualAuthenticator(page)

  // The authenticator is per-browser, so it survives the cross-origin hop to
  // Estiva ID and back. The CDP session is bound to this page/tab, which the
  // redirect reuses.
  await page.goto(`${APP_ORIGIN}/topics`, { waitUntil: 'domcontentloaded', timeout })

  // The shell probes silently first (prompt=none). With no session it settles on
  // a single button; WebAuthn needs a user activation, so this click is required
  // and cannot be skipped.
  const button = page.getByRole('button', { name: /continue with passkey/i })
  await button.waitFor({ state: 'visible', timeout })
  await button.click()

  // Back on Peek's own origin with a token in sessionStorage = signed in.
  await page.waitForFunction(
    () => !!window.sessionStorage.getItem('peek.estivaId.token'),
    undefined,
    { timeout },
  )

  const pubkey = await page.evaluate(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem('peek.estivaId.token') ?? '{}').pubkey ?? null
    } catch {
      return null
    }
  })

  return { browser, context, page, pubkey, authenticatorId, cdp }
}

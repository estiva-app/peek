/**
 * The one live relay client a tab has, and the topics it is watching (PEE-8).
 *
 * PEE-5 built the socket, PEE-6 the per-channel subscriptions, PEE-7 the
 * routing into Convex. All three were unconsumed until this file, which owns
 * the single instance of each and hands `useTopicView` a `watch()` call.
 *
 * ## Why a module singleton rather than a hook or a context
 *
 * **One connection per tab** is a property of the design, not an optimisation:
 * `max_subscriptions` is per connection, the relay authenticates a connection
 * once, and a second socket would double the AUTH round trips for nothing. A
 * connection created inside a component would be one per mount.
 *
 * React StrictMode makes that concrete in development — it mounts, unmounts and
 * remounts every component, so anything owned by an effect is built twice. A
 * module-level instance is built once and simply watched twice, which is
 * exactly what PEE-6's refcounting already handles: two `watch()` calls on one
 * channel share one REQ, and the channel closes when the second releases.
 *
 * ## The credential is read per connect, never captured
 *
 * `getCredential` calls `validToken()` on every connect attempt. Capturing a
 * token at module load is the trap `useTopicView` already documents for the
 * HTTP path: a page opened while the stored token had expired would keep a dead
 * credential for the whole session, and here it would also mean a reconnect
 * after a renewal signing with the expired one.
 *
 * The socket itself needs no attention when the token rotates — the relay
 * authenticated a **pubkey** by checking a signature and never saw the token.
 * See `liveRelay.ts`.
 */
import { validToken } from '@/auth/estivaId'
import { createChannelSubscriptions, type ChannelSubscriptions } from './channelSubscriptions'
import {
  createLiveProjection,
  type LiveProjection,
  type LiveProjectionApi,
  type WatchHandle,
} from './liveProjection'
import { createLiveRelay, type LiveRelay, type RelayState } from './liveRelay'
import { signViaEstivaId } from './bridge'
import {
  reasonForSignFailure,
  recordCredentialFailure,
  recordCredentialOk,
  recordRelayState,
} from './freshness'

export interface LiveTopics {
  /** Watch one topic's channel. Refcounted — safe to call twice for one topic. */
  watch(args: { topicKey: string; channelUuid: string }): WatchHandle
  state(): RelayState
  /** Subscribe to connection-state changes. Returns an unsubscribe. PEE-9 consumes this. */
  onState(listener: (state: RelayState) => void): () => void
}

interface Instance extends LiveTopics {
  relayUrl: string
  relay: LiveRelay
  subscriptions: ChannelSubscriptions
  projection: LiveProjection
}

let instance: Instance | null = null

function build(relayUrl: string, api: LiveProjectionApi): Instance {
  const listeners = new Set<(state: RelayState) => void>()
  let state: RelayState = 'connecting'

  const relay = createLiveRelay({
    url: relayUrl,
    // Fresh on every connect attempt — see the header.
    getCredential: () => {
      const token = validToken()
      if (!token) {
        // No credential at all. Reported rather than merely logged, because
        // this is the state PEE-9 has to be able to tell apart from a quiet
        // channel — but it is *not* yet "signed out": every silent renewal
        // passes through here, so `freshness.ts` holds it for a grace period
        // before saying anything.
        recordCredentialFailure('session_expired')
        return null
      }
      return { accessToken: token.accessToken, pubkey: token.pubkey }
    },
    sign: async (unsigned, token, expectedPubkey) => {
      try {
        const signed = await signViaEstivaId(unsigned, token, expectedPubkey)
        recordCredentialOk()
        return signed
      } catch (error) {
        // The status is the honest signal — and the difference between
        // "expired" and "this app cannot verify the token" decides whether
        // sending somebody to sign in again helps or wastes their time.
        recordCredentialFailure(reasonForSignFailure((error as Error).message))
        throw error
      }
    },
    onState: (next) => {
      state = next
      recordRelayState(next)
      for (const listener of [...listeners]) listener(next)
    },
    log: (message, detail) => console.debug('[relay]', message, detail ?? ''),
  })

  const subscriptions = createChannelSubscriptions(relay, {
    onListenerError: (error) => console.warn('[relay] a channel listener threw:', error),
  })

  const projection = createLiveProjection({
    subscriptions,
    api,
    log: (message, detail) => console.warn('[relay]', message, detail ?? ''),
  })

  return {
    relayUrl,
    relay,
    subscriptions,
    projection,
    watch: (args) => projection.watch(args),
    state: () => state,
    onState(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The tab's live client, built on first use.
 *
 * `api` is only read when the instance is built; the Convex client it closes
 * over is stable for the life of the page, so a later caller passing a fresh
 * object does not rebuild anything.
 */
export function getLiveTopics(relayUrl: string, api: LiveProjectionApi): LiveTopics {
  if (instance && instance.relayUrl === relayUrl) return instance
  // A changed relay origin means a different deployment — tear down rather than
  // leaving a socket pointed at the old one. Not expected in a page's lifetime.
  if (instance) {
    instance.projection.stopAll()
    instance.relay.close()
  }
  instance = build(relayUrl, api)
  return instance
}

/** Test seam. Drops the instance so the next `getLiveTopics` builds a new one. */
export function resetLiveTopicsForTests(): void {
  if (instance) {
    instance.projection.stopAll()
    instance.relay.close()
  }
  instance = null
}

/**
 * The one live relay client a tab has, and the topics it is watching (PEE-8).
 *
 * ## What is left here after SHA-7
 *
 * Almost nothing, on purpose. The socket, the credential-per-connect rule, the
 * per-tab single instance and the `online`/`offline` reconnect all moved to
 * `@estiva-app/platform`, because a second app needed them and would otherwise
 * have written all four again. ADR 0002 §10 scored this file ❌ on constraint 1
 * (it imported the app's credential provider) and ❌ on constraint 2 (a
 * module-level singleton and a `window` touch) and called it "the bill SHA-7 is
 * paying" — so the extraction had to *change* the code, not relocate it.
 *
 * What stays is the wiring only Peek can do:
 *
 * - **`liveProjection`**, which is Convex-shaped. `LiveProjectionApi` is
 *   `importChannel` / `importReactions` / `importResolutions`, and putting that
 *   in a shared package would have baked Peek's backend into something Ship
 *   depends on.
 * - **`freshness.ts`**, whose four states and their copy are product voice. The
 *   package is *told* what happened through `observe` and holds none of it.
 * - **The single module binding.** `createLiveClientHolder()` is the mechanism;
 *   keeping the one instance is the app's job, because a module-level global in
 *   the package is the exact constraint-2 failure it exists to stop repeating.
 *
 * The public shape of this file is unchanged, deliberately: `useTopicView`,
 * `LiveWorkingSet`, `useFolderContents` and `useFolderProject` are untouched by
 * this migration, so a regression shows up as those features breaking rather
 * than as a large diff to read.
 *
 * ## Token rotation still needs nothing
 *
 * The relay authenticated a **pubkey**, by verifying a Schnorr signature. It
 * never saw the Estiva ID access token and has no idea one exists. Renewal
 * issues a new token for the same keypair, so nothing the relay checked has
 * changed. The token is needed only to *sign* a fresh 22242, which happens on
 * the next connect — and `getCredential` below is read then, never captured.
 */
import { validToken } from '@/auth/estivaId'
import {
  browserOnlineSource,
  createFolderActivity,
  createLiveClientHolder,
  type FolderActivity,
  type LiveClient,
} from '@estiva-app/platform'
import { KIND, type RelayState } from '@estiva-app/protocol'
import {
  createLiveProjection,
  type ContainerRef,
  type LiveProjection,
  type LiveProjectionApi,
  type WatchHandle,
} from './liveProjection'
import { signViaEstivaId } from './bridge'
import {
  reasonForSignFailure,
  recordCredentialFailure,
  recordCredentialOk,
  recordOnline,
  recordRelayState,
} from './freshness'

export interface LiveTopics {
  /**
   * Watch one container's channel — a topic or a DM (DMS-5). Refcounted, so it
   * is safe to call twice for one container.
   */
  watch(args: ContainerRef & { channelUuid: string }): WatchHandle
  state(): RelayState
  /** Subscribe to connection-state changes. Returns an unsubscribe. PEE-9 consumes this. */
  onState(listener: (state: RelayState) => void): () => void
  /**
   * Watch one Folder for *another app's* records changing — a Ship issue moved,
   * a project renamed. Returns an unsubscribe.
   *
   * The socket already delivers these because the subscription is kindless;
   * they were dropped for want of anywhere to put them. This is that place, and
   * it carries no event: Peek does not store other apps' records, so the useful
   * signal is "re-read now".
   *
   * Fed by `liveProjection` rather than by the client's own `watchFolders`,
   * because the projection is what knows which events it did *not* project. A
   * workspace reader with no projection — Ship — uses the other path.
   */
  onForeignActivity(folder: string, listener: () => void): () => void
  /**
   * Watch many channels for *anything said in them*, in one REQ per 128
   * (SHR-5). `stop()` closes the REQs and forgets the listener.
   *
   * The half `onForeignActivity` cannot cover, and the reason both exist. That
   * one is fed by the projection and reports only what it did **not** take,
   * which is right for another app's records and useless for a topic's own
   * `kind:9` — precisely what the projection does take. And {@link watch} is
   * per channel and refcounted, so a sidebar's worth of topics would be a REQ
   * each: `REQ` is metered on `LimitType::WsEvents` and 50 unpaced ones are
   * refused (LIV-1).
   *
   * So this is the client's own `watchFolders`: a wide filter, one frame, told
   * which channel changed rather than what changed. Nothing is projected for
   * the channels watched this way — the listener is a "re-read now" signal
   * carrying no event, which is all an unread dot needs.
   *
   * **It depends on the deployed relay, not on this code.** The plural
   * `extract_channel_ids_from_filters` is what makes a wide filter fan out;
   * against a build with the singular version the same REQ is accepted and
   * silently delivers nothing — EOSE, `live`, no error. Every caller must
   * therefore keep whatever fallback it had.
   *
   * `kinds` narrows the filter; the default is both message kinds. A file page
   * passes `[KIND.COMMENT]` alone (FOL-32), because a Folder's `h` also carries
   * its own `kind:9` chat and a re-read of a file for every line said in the
   * Folder would be the wide filter's cost with none of its point.
   */
  watchChannels(
    channelUuids: readonly string[],
    listener: (channelUuid: string) => void,
    options?: { kinds?: readonly number[] },
  ): { stop(): void }
}

/**
 * The app's one binding. `@estiva-app/platform` hands out a holder rather than
 * keeping an instance, so this line is where "one per tab" actually lives.
 */
const holder = createLiveClientHolder()

/**
 * Messages that mean a live feature has silently stopped working.
 *
 * The client's log is `console.debug`, which the browser hides at its default
 * level — right for a frame-by-frame trace and wrong for these. A refused
 * subscription, a credential that never arrives and an auth the relay rejects
 * each disable something the person is looking at, with no other symptom than
 * the feature quietly not happening. FOL-40 cost three rounds partly because
 * the one line that would have named the cause was a level nobody had turned
 * on.
 */
const LOUD = ['closed', 'refused', 'giving up', 'no credential', 'could not sign']

/** The relay client's log: quiet by default, loud when something stopped. */
export function relayLog(message: string, detail?: unknown): void {
  const loud = LOUD.some((phrase) => message.includes(phrase))
  const write = loud ? console.warn : console.debug
  write('[relay]', message, detail ?? '')
}

interface Wiring {
  relayUrl: string
  client: LiveClient
  projection: LiveProjection
  activity: FolderActivity
  topics: LiveTopics
}

let wiring: Wiring | null = null

function build(relayUrl: string, api: LiveProjectionApi): Wiring {
  const client = holder.get({
    relayUrl,
    // Fresh on every connect attempt — see the header.
    getCredential: () => {
      const token = validToken()
      if (!token) return null
      return { accessToken: token.accessToken, pubkey: token.pubkey }
    },
    sign: signViaEstivaId,
    online: typeof window === 'undefined' ? undefined : browserOnlineSource(window),
    subscriptionPrefix: 'peek-',
    observe: {
      onState: recordRelayState,
      onOnline: recordOnline,
      // Not yet "signed out": every silent renewal passes through here, so
      // `freshness.ts` holds it for a grace period before saying anything.
      onCredentialMissing: () => recordCredentialFailure('session_expired'),
      onSignOk: recordCredentialOk,
      // The difference between "expired" and "this app cannot verify the
      // token" decides whether sending somebody to sign in again helps or
      // wastes their time.
      onSignFailure: (error) => recordCredentialFailure(reasonForSignFailure(error)),
    },
    log: relayLog,
  })

  const activity = createFolderActivity()

  const projection = createLiveProjection({
    subscriptions: client.subscriptions,
    api,
    log: (message, detail) => console.warn('[relay]', message, detail ?? ''),
    // A channel uuid *is* the Folder id (RFC 0.4 §5.2, measured across all 50
    // production channels), so no translation is needed here.
    onForeignActivity: (channelUuid) => activity.notify(channelUuid),
  })

  return {
    relayUrl,
    client,
    projection,
    activity,
    topics: {
      watch: (args) => projection.watch(args),
      state: () => client.state(),
      onState: (listener) => client.onState(listener),
      onForeignActivity: (folder, listener) => activity.watch(folder, listener),
      // `kinds` rather than kindless on purpose: a kindless wide filter is
      // refused outright on some builds with `restricted: p-gated events
      // require #p matching your pubkey`. Both message kinds, because a
      // comment written before Ship flipped stays `kind:9` for ever.
      watchChannels: (channelUuids, listener, options) => {
        const kinds = [...(options?.kinds ?? [KIND.STREAM_MESSAGE, KIND.COMMENT])]
        /*
          Said out loud, once per subscription. A wide filter is the only live
          path with no visible effect when it works and none when it does not,
          so "did this tab even ask?" was unanswerable from a console at its
          default level — and it is the first question every time a dot does
          not move.
        */
        console.info(
          `[relay] watching ${channelUuids.length} folder(s) for kinds ${kinds.join(', ')}`,
        )
        return client.watchFolders([...channelUuids], listener, { kinds })
      },
    },
  }
}

/**
 * The tab's live client, built on first use.
 *
 * `api` is only read when the wiring is built; the Convex client it closes over
 * is stable for the life of the page, so a later caller passing a fresh object
 * does not rebuild anything.
 */
export function getLiveTopics(relayUrl: string, api: LiveProjectionApi): LiveTopics {
  if (wiring && wiring.relayUrl === relayUrl) return wiring.topics
  // A changed relay origin means a different deployment — tear down rather than
  // leaving a socket pointed at the old one. Not expected in a page's lifetime.
  // The holder closes the old client; the projection is ours to stop.
  wiring?.projection.stopAll()
  wiring = build(relayUrl, api)
  return wiring.topics
}

/**
 * The live client if one exists, without building it.
 *
 * `getLiveTopics` needs the Convex actions because it may have to *construct*
 * the projection. A consumer that only wants to listen — the project panel
 * watching for another app's records — has no business holding those, and
 * making it pass them would put Convex in the dependency list of a component
 * that reads the relay directly.
 *
 * Returns null before the topic view has connected, which is a real state
 * rather than an error: the panel falls back to its timer, which is what it did
 * for everything until now.
 */
export function peekLiveTopics(): LiveTopics | null {
  return wiring?.topics ?? null
}

/** Test seam. Drops the instance so the next `getLiveTopics` builds a new one. */
export function resetLiveTopicsForTests(): void {
  wiring?.projection.stopAll()
  wiring = null
  holder.reset()
}

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
 * - **`freshness.ts`**, whose four states and their copy are product voice. The
 *   package is *told* what happened through `observe` and holds none of it.
 * - **The single module binding.** `createLiveClientHolder()` is the mechanism;
 *   keeping the one instance is the app's job, because a module-level global in
 *   the package is the exact constraint-2 failure it exists to stop repeating.
 *
 * There was a third, `liveProjection`, which imported every watched topic and
 * DM channel into Convex (`nostr.sync.import*`). It went with the Convex topics
 * in FOL-23, and with it `watch` and `onForeignActivity`, the two halves of
 * this interface only the projection could feed. Nothing here needs Convex now.
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
import { browserOnlineSource, createLiveClientHolder, type LiveClient } from '@estiva-app/platform'
import { KIND, type RelayState, type SignedEvent } from '@estiva-app/protocol'
import { signViaEstivaId } from './bridge'
import {
  reasonForSignFailure,
  recordCredentialFailure,
  recordCredentialOk,
  recordOnline,
  recordRelayState,
} from './freshness'
import { meteredSocket } from './socketFrames'

export interface LiveTopics {
  state(): RelayState
  /** Subscribe to connection-state changes. Returns an unsubscribe. PEE-9 consumes this. */
  onState(listener: (state: RelayState) => void): () => void
  /**
   * Watch many channels for *anything said in them*, in one REQ per 128
   * (SHR-5). `stop()` closes the REQs and forgets the listener.
   *
   * A per-channel REQ each would not do: `REQ` is metered on
   * `LimitType::WsEvents` and 50 unpaced ones are refused (LIV-1). So this is
   * the client's own `watchFolders`: a wide filter, one frame, told which
   * channel changed rather than what changed.
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
   *
   * The listener is handed the event too (PER-8, platform 0.2.0), for a reader
   * that keeps what it has read and can apply it rather than re-read —
   * `channelStore.ts`. `since` bounds what the REQ replays on subscribe and on
   * every reconnect; a keeping reader passes it, a signal-only one need not.
   */
  watchChannels(
    channelUuids: readonly string[],
    listener: (channelUuid: string, event?: SignedEvent) => void,
    options?: { kinds?: readonly number[]; since?: number },
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

/**
 * How long after subscribing a delivery is still stored history.
 *
 * The REQ carries no `since`, so the relay answers with a page of stored
 * events before EOSE. Measured on production: 81 Folders delivered its whole
 * page **within 2 ms**, 221–223 ms after subscribing. So the boundary does not
 * need to be tight, and a generous one is safer — a live event misfiled as
 * backfill is the failure that matters, and it is the one this window is sized
 * against.
 */
const WIDE_FILTER_BACKFILL_MS = 3_000

/** Past this many live deliveries the log stops, so a busy tab is not flooded. */
const WIDE_FILTER_LIVE_CEILING = 200

/**
 * The wide filter's delivery log: silent for history, loud for anything live.
 *
 * **The first cut of this counted deliveries and stopped at 25, and that was
 * the wrong axis.** A backfill of a page is dozens of events in two
 * milliseconds, so it spent the whole budget before the interesting line could
 * exist, and the console proved only that the REQ matched *something* — which
 * was never in doubt. Counting history separately from live is the only shape
 * that answers the question, because the two differ by three orders of
 * magnitude in volume and by everything in meaning.
 *
 * So: history is one summary line, printed when the window closes; every live
 * delivery gets its own. A reader does not have to interpret elapsed times —
 * the summary line is a ruler, and anything below it arrived live.
 */
export function wideFilterDeliveryLog(watchSize: number): {
  record: (folder: string) => void
  resubscribed: () => void
  stop: () => void
} {
  let watchedAt = Date.now()
  let backfill = 0
  let live = 0
  let resubscribes = 0
  let lastLive: WideFilterSnapshot['lastLive']
  let summary: ReturnType<typeof setTimeout>
  const openWindow = () => {
    summary = setTimeout(() => {
      console.info(
        `[relay] wide filter of ${watchSize}: ${backfill} stored event(s) in the first ${WIDE_FILTER_BACKFILL_MS}ms. Anything below this line arrived live.`,
      )
    }, WIDE_FILTER_BACKFILL_MS)
  }
  openWindow()
  const entry = {
    snapshot: (): WideFilterSnapshot => ({
      folders: watchSize,
      subscribedAt: new Date(watchedAt).toISOString(),
      stored: backfill,
      live,
      resubscribes,
      ...(lastLive ? { lastLive } : {}),
    }),
  }
  wideFilters.add(entry)
  return {
    /*
      A reconnect re-issues every REQ (`protocol`'s `live.ts`), and a re-issued
      REQ carries no `since` — so the relay replays its stored page again,
      minutes after the watch was created. Measured from the original
      `watchedAt` those land outside the backfill window and were counted, and
      printed, as **live**. That is the instrument inventing the signal it
      exists to detect, and it is how a burst of 77 replayed events at once
      reads as a fan-out storm.

      So the window belongs to the *subscription*, not to the watch: each
      re-issue restarts it, and `resubscribes` says how many times that
      happened, because a reading taken across one is not the same reading.
    */
    resubscribed: () => {
      resubscribes += 1
      watchedAt = Date.now()
      backfill = 0
      clearTimeout(summary)
      openWindow()
    },
    record: (folder: string) => {
      const elapsed = Date.now() - watchedAt
      if (elapsed < WIDE_FILTER_BACKFILL_MS) {
        backfill += 1
        return
      }
      live += 1
      lastLive = { folder, at: new Date().toISOString(), msAfterSubscribing: elapsed }
      if (live > WIDE_FILTER_LIVE_CEILING) return
      console.info(
        `[relay] wide filter of ${watchSize} delivered LIVE #${live} for ${folder}, ${elapsed}ms after subscribing`,
      )
    },
    stop: () => {
      wideFilters.delete(entry)
      clearTimeout(summary)
    },
  }
}

/** What `window.__wideFilters()` answers, per live wide filter. */
export interface WideFilterSnapshot {
  /** How many Folders this REQ asked about. 81 is the team dots, 26 the topics. */
  folders: number
  subscribedAt: string
  /** Events delivered inside the backfill window: stored history, not a signal. */
  stored: number
  /** Events delivered after it. **Zero here is the finding**, not an absence of data. */
  live: number
  /**
   * How many times the REQ was re-issued after a reconnect.
   *
   * Above zero, `stored` counts only the most recent replay and
   * `msAfterSubscribing` is measured from it. A reading taken across a
   * reconnect is not one reading.
   */
  resubscribes: number
  lastLive?: { folder: string; at: string; msAfterSubscribing: number }
}

const wideFilters = new Set<{ snapshot: () => WideFilterSnapshot }>()

/**
 * `window.__wideFilters()` — every wide filter this tab holds, and what each
 * has delivered.
 *
 * The console lines are chronological, and that turned out to be the wrong
 * shape for the question. Reading them needs the right page to have been open
 * when the tab loaded, the scrollback to reach back far enough, and the
 * summary line to be found among a thousand others — and three readings in a
 * row were lost to one of those rather than to the bug. A snapshot needs none
 * of it: comment from the other identity, then call this.
 *
 * `live: 0` on the 81-Folder entry, with a `live` above zero on a 1-Folder
 * entry, is the whole of FOL-40's remaining question answered in one line.
 */
export function installWideFilterDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__wideFilters = () =>
    [...wideFilters].map((entry) => entry.snapshot())
}

interface Wiring {
  relayUrl: string
  client: LiveClient
  topics: LiveTopics
}

let wiring: Wiring | null = null

function build(relayUrl: string): Wiring {
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
    // The socket reader counts these frames against buzz's budget (OPT-2).
    socketFactory: typeof WebSocket === 'undefined' ? undefined : meteredSocket,
  })

  return {
    relayUrl,
    client,
    topics: {
      state: () => client.state(),
      onState: (listener) => client.onState(listener),
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
        /*
          And said out loud again when it *delivers* — the question peek#290
          left unanswerable (FOL-40).

          "Was the REQ accepted?" is answered by the absence of a closure, and
          it is the wrong question. A filter naming many distinct `#h` values
          is classified by the relay's `extract_channel_id_from_filters` as a
          **global** subscription the moment two of them differ, and
          `fan_out_scoped` documents a symmetric invariant — a global
          subscription is never handed an event that carries a channel. A
          `kind:9` or `kind:1111` in a Folder carries one. On that build the
          REQ is accepted, EOSE arrives, the socket reports `live`, and no
          *live* event is ever delivered, with no error anywhere. Stored
          history still arrives, because the historical query is scoped by the
          viewer's accessible channels rather than by the fan-out index — which
          is exactly why counting deliveries settles nothing and only their
          timing does.

          Measured on production, 81 Folders: the whole stored page arrived
          inside 2 ms, 221 ms after subscribing. So history is summarised in
          one line and every live delivery gets its own, and a reader needs no
          arithmetic — the summary line is a ruler, and what is under it is
          live.

          `useLiveFile` watches a single Folder, and a single `#h` is
          channel-scoped on every build, so one console also holds its own
          control: a 1-Folder watch delivering live while an 81-Folder watch
          does not is the count, not the socket.

          The listener is safe to read this way. `client.watchFolders` notifies
          through the *client's* own folder activity, whose only writer is that
          subscription's handler — Peek's `activity` above is a different
          object, fed by the projection. Nothing else can make this fire.
        */
        const log = wideFilterDeliveryLog(channelUuids.length)
        /*
          Every return to `live` re-issues the REQ, so it opens a new backfill
          window (`wideFilterDeliveryLog`). Read off the socket's own state
          rather than from a reconnect callback, because the thing that matters
          is the same thing `useTeamUnread` already treats as a re-read: the
          transition into `live`, whatever caused it.
        */
        let wasLive = client.state() === 'live'
        const unwatchState = client.onState((state) => {
          if (state === 'live' && !wasLive) log.resubscribed()
          wasLive = state === 'live'
        })
        const watch = client.watchFolders(
          [...channelUuids],
          (folder, event) => {
            log.record(folder)
            listener(folder, event)
          },
          { kinds, ...(options?.since !== undefined ? { since: options.since } : {}) },
        )
        return {
          stop: () => {
            unwatchState()
            log.stop()
            watch.stop()
          },
        }
      },
    },
  }
}

/** The tab's live client, built on first use. */
export function getLiveTopics(relayUrl: string): LiveTopics {
  if (wiring && wiring.relayUrl === relayUrl) return wiring.topics
  // A changed relay origin means a different deployment — tear down rather than
  // leaving a socket pointed at the old one. Not expected in a page's lifetime.
  // The holder closes the old client.
  wiring = build(relayUrl)
  return wiring.topics
}

/**
 * The tab's live client itself, for one-shot reads over the same socket
 * (`socketRead.ts`, OPT-2). Built on first use, like `getLiveTopics`, so a read
 * at boot opens the connection the first topic would have opened anyway.
 * `null` for a relay other than the one the tab is connected to: building one
 * would tear down the tab's socket and every watch on it.
 */
export function getLiveClient(relayUrl: string): LiveClient | null {
  if (wiring && wiring.relayUrl !== relayUrl) return null
  getLiveTopics(relayUrl)
  return wiring!.client
}

/** Test seam. Drops the instance so the next `getLiveTopics` builds a new one. */
export function resetLiveTopicsForTests(): void {
  wiring = null
  holder.reset()
}

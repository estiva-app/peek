/**
 * Drafts — CON-10.
 *
 * A message you started and did not send is still there when you come back, in
 * the composer you were typing in and in no other.
 *
 * ## Local, and never on the relay
 *
 * A draft is **unsent**. Publishing one — even to SPEC §12's app-private layer,
 * where read state lives — turns something a person chose not to say into
 * something the workspace holds, and a `kind:5` is a request rather than a
 * reversal, so it could not reliably be taken back. PEE-7 asked whether this
 * needs a Buzz change; it does not, and should not.
 *
 * The cost is real and is the right way round: drafts do not follow you to
 * another device or another browser, and clearing site data loses them.
 *
 * ## The key is the whole feature
 *
 * PEE-7 reports two symptoms — text appearing in a topic it was not written
 * for, and text lost on returning to the thread it *was* written for. They are
 * one bug seen from both sides: the composer's text is held in memory and not
 * keyed by **destination**. So a draft is stored against the thing the message
 * would be published to, and `draftKeys` below is the only place that decides.
 *
 * ## The same file in two apps, deliberately
 *
 * This is Ship's `web/src/lib/drafts.ts`, copied. Both apps need the identical
 * rule about *where a draft belongs*, and two apps disagreeing about that is
 * the failure mode — a thread would get one draft in Peek and another in Ship.
 * The duplication is recorded rather than silent, and CON-5 collapses it into
 * `@estiva-app/conversation`.
 *
 * The one difference until then: Peek adds `container`, because a topic and a
 * DM are destinations Ship has no equivalent of. Ship's copy gains it at
 * extraction.
 *
 * ## Injected storage, no app around it
 *
 * Everything here takes its `Storage` rather than reaching for `localStorage`,
 * which is what lets it be tested with no browser and moved into
 * `@estiva-app/conversation` (CON-5) without a rewrite. It is also the seam
 * that makes "storage is unavailable" a case rather than a crash.
 */

/** How long a draft survives, and why it is not forever. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The longest draft that is kept.
 *
 * `localStorage` is a shared ~5 MB budget for this origin — read state's
 * diagnostics and everything else live in it too — and a runaway paste should
 * not be able to evict them. Beyond this the draft is simply not stored: the
 * text is still in the field the person is typing in, so nothing is lost in
 * front of them; it just will not survive a reload, which is the honest
 * outcome and better than breaking storage for everything else.
 */
export const DRAFT_MAX_CHARS = 8000

/** Namespaced and versioned, so a shape change can be ignored rather than mis-read. */
const PREFIX = 'estiva.draft.v1:'

/**
 * Where a draft belongs.
 *
 * **A thread is keyed by its own root event, not by the surface showing it.** A
 * reply half-written on an issue page and the same reply seen from a project's
 * Activity are the same destination, so they are the same draft — anything else
 * would give one thread two drafts and reproduce half of PEE-7.
 */
export const draftKeys = {
  /** Starting a conversation about an object — its address. */
  object: (addr: string) => `object:${addr}`,
  /** Replying in a thread — the thread's root event id. */
  thread: (rootEventId: string) => `thread:${rootEventId}`,
  /**
   * Writing into a container itself — a Peek topic, a DM.
   *
   * Keyed by the container Peek routes to rather than by the Folder: the id in
   * the URL is what a person navigates between, and it is what changes when
   * they switch topics, which is the moment PEE-7 is about.
   */
  container: (id: string) => `container:${id}`,
}

interface StoredDraft {
  text: string
  /** When it was last typed, for the age cap. */
  at: number
}

export interface DraftStore {
  /** The draft for this key, or `undefined` — including when storage is unusable. */
  read(key: string): string | undefined
  /** Keep this text. An empty or whitespace-only draft is a cleared one. */
  write(key: string, text: string): void
  /** Forget it — what a successful send calls. */
  clear(key: string): void
}

/** A store that keeps nothing, for when there is no storage to use. */
const NOTHING: DraftStore = { read: () => undefined, write: () => {}, clear: () => {} }

/**
 * A draft store over some `Storage`.
 *
 * **Every operation is guarded.** A private window, cleared site data, a
 * browser configured to block storage, or a quota that is already full all
 * surface as "no draft" rather than as a broken composer — and the accessor
 * itself can throw, not just the write, which is why the reads are wrapped too.
 */
export function createDraftStore(
  storage: Storage | undefined,
  now: () => number = Date.now,
): DraftStore {
  if (!storage) return NOTHING

  const remove = (key: string) => {
    try {
      storage.removeItem(PREFIX + key)
    } catch {
      // Nothing to do and nothing worth saying: the draft is already
      // unreachable as far as anybody reading it is concerned.
    }
  }

  return {
    read(key) {
      try {
        const raw = storage.getItem(PREFIX + key)
        if (!raw) return undefined
        const draft = JSON.parse(raw) as Partial<StoredDraft>
        if (typeof draft?.text !== 'string' || typeof draft?.at !== 'number') {
          // Written by a different version, or corrupted. Dropping it is
          // better than showing somebody a string this code cannot vouch for.
          remove(key)
          return undefined
        }
        if (now() - draft.at > DRAFT_MAX_AGE_MS) {
          // A draft from months ago reappearing is surprising rather than
          // helpful, and cleaning it up here is the only sweep this has.
          remove(key)
          return undefined
        }
        return draft.text
      } catch {
        return undefined
      }
    },

    write(key, text) {
      // Whitespace is not a draft. Clearing rather than storing it means
      // emptying the field also forgets it, which is what a person means.
      if (!text.trim()) return remove(key)
      if (text.length > DRAFT_MAX_CHARS) return remove(key)
      try {
        const draft: StoredDraft = { text, at: now() }
        storage.setItem(PREFIX + key, JSON.stringify(draft))
      } catch {
        // Quota, or storage refused. The text is still in the field; it just
        // will not survive a reload.
      }
    },

    clear: remove,
  }
}

/**
 * The store this app uses.
 *
 * Resolved once, defensively: reading `window.localStorage` can itself throw
 * where a browser blocks site data, so the failure has to be caught here rather
 * than at the first `getItem`.
 */
export function browserDrafts(): DraftStore {
  try {
    return createDraftStore(typeof window === 'undefined' ? undefined : window.localStorage)
  } catch {
    return NOTHING
  }
}

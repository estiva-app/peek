/**
 * "Something of another app's changed in this Folder."
 *
 * The socket's subscription is **kindless**, so a Ship project, issue or change
 * event already arrives in the browser the moment it is published — it was
 * simply dropped, because `liveProjection` projects message-shaped kinds into
 * Convex and nothing else. The panel that renders those records therefore had
 * to poll, and `TopicProjectPanel` says so in a comment ending *"worth its
 * own"*. This is that.
 *
 * ## Why a notification rather than a projection
 *
 * Peek does not store Ship's records and should not start. The panel reads them
 * off the relay directly, which is the whole design — Convex holds Peek's
 * things, the relay holds the shared ones (ADR 0001). So the useful signal is
 * not the event; it is *"re-read now"*.
 *
 * That also keeps this correct for kinds nobody has invented yet. A fourth app
 * publishing its own records into a shared Folder gets a live panel without
 * Peek learning what those records are.
 *
 * ## Deliberately not a singleton
 *
 * A module-level emitter is what `liveTopics.ts` did, and SHA-7 is the bill for
 * it. This exports a factory; the app instantiates one and passes it in, and a
 * test makes its own.
 */
export type FolderListener = () => void

export interface ForeignActivity {
  /** Say that something changed in `folder`. Safe to call for a folder nobody watches. */
  notify(folder: string): void
  /** Watch one folder. Returns an unsubscribe; calling it twice is harmless. */
  watch(folder: string, listener: FolderListener): () => void
}

export function createForeignActivity(): ForeignActivity {
  const listeners = new Map<string, Set<FolderListener>>()
  return {
    notify(folder) {
      for (const listener of listeners.get(folder) ?? []) {
        // One bad listener must not stop the others, and must not surface as a
        // relay error somewhere unrelated.
        try {
          listener()
        } catch {
          /* a listener's own problem */
        }
      }
    },
    watch(folder, listener) {
      const held = listeners.get(folder) ?? new Set()
      held.add(listener)
      listeners.set(folder, held)
      return () => {
        held.delete(listener)
        if (held.size === 0) listeners.delete(folder)
      }
    },
  }
}

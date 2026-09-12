/**
 * Peek's NIP-89 manifest — the first one Peek has ever published (PRO-6).
 *
 * Until now Peek has only ever been a *consumer*: it reads Ship's manifest and
 * renders Ship's objects. Nothing of Peek's could be rendered anywhere else,
 * so the projection layer has run in exactly one direction since it was built.
 * This is the producer half of closing that loop; Ship rendering one of these
 * is PRO-7.
 *
 * Writing it surfaced three things the mechanism could not express, each of
 * which is now in `interop/projection.ts` and RFC 0.4. That is the point of a
 * second direction, and it is why §13.5 insists the layer must not be published
 * as a package until one exists.
 */
import type { ManifestAction } from '@estiva-app/interop'

/** The relay's own kind for a channel's discovery record. */
export const TOPIC_KIND = 39000
/** A message in a channel. NIP-29's, and not addressable — see below. */
export const MESSAGE_KIND = 9

export const MANIFEST_D_TAG = 'estiva-peek'

/**
 * The actions this manifest declares, typed as the vocabulary they are
 * published in (INT-9).
 *
 * Ship narrows its own `Projection['widget']` to a closed union for the stated
 * reason that *"the compiler makes an unpublishable declaration unwritable
 * here, which is a stronger guarantee than the runtime check"*. Peek's actions
 * had no such type: `effect: 'writes'` widened to `string` and
 * `target: 'content'` widened to `string`, so a typo in either was a runtime
 * discovery. `ManifestAction` is interop's own shape, which is the one a
 * consumer reads this back as.
 *
 * `actionProblems` still runs in `publish-manifest.ts` and is not made
 * redundant by this: the compiler checks the shape, and that check is the prose
 * rule — a description a caller could actually match on — which no type can
 * express.
 */
const ACTIONS: ManifestAction[] = [
  {
    id: 'start-a-conversation',
    label: 'Start a conversation',
    /*
      Prose for a machine, not a caption — RFC 0.4 §13.4, and the rule
      interop's `actionProblems` enforces before this is signed (PRO-16).
      What it has to carry that the label cannot: that this starts a new
      thread rather than answering one, since a caller reading only
      "Start a conversation" would reasonably pick it to reply.
    */
    description:
      'Start a new conversation in a topic, as a root message that people can then reply to. ' +
      'Use when something is worth its own thread rather than an answer inside an existing one — ' +
      'this cannot reply to a message, and there is deliberately no action that can.',
    effect: 'writes',
    appliesTo: String(TOPIC_KIND),
    emits: { kind: MESSAGE_KIND, toAddressOf: 'self' },
    input: {
      type: 'object',
      /*
        One property, and it is the body. `target: 'content'` is what makes
        a message declarable at all — see above. A title would be a second
        field with nowhere to go: a `kind:9` has a body and an author and
        that is the whole object.
      */
      properties: { message: { type: 'string', target: 'content' } },
      required: ['message'],
    },
  },
]


export function manifestContent() {
  return {
    name: 'Peek',
    about: 'Conversations',

    /**
     * **Peek is a generic app: it renders the conversation of every file**
     * (RFC 0.5 §10.7, the one field that section adds to a manifest).
     *
     * The `k` tags below say which kinds Peek *owns* — a channel and a
     * message, both legacy shapes. This says what it does for everybody
     * else's files, and it is what a consumer reads to find where a file
     * nobody owns can be opened: a bare file (`kind:30840`, a topic since
     * peek#194) has no `web` template of its own, so interop takes the one
     * on the manifest declaring this aspect. Ship's Related card for a topic
     * under a project becomes a link into `/o/<naddr>` the moment this is
     * published (FOL-17), and `ObjectPage` opens it beside its Folder.
     */
    aspect: 'conversation',

    /**
     * **No `records` rule, and that is a statement rather than an omission.**
     *
     * Ship declares one because a Ship issue's status lives in change events
     * and cannot be read off the issue. Nothing of Peek's works that way: a
     * topic's name is a tag the relay wrote, and a message is immutable. A
     * consumer that folded nothing would render both correctly.
     */
    projections: {
      [TOPIC_KIND]: {
        widget: 'card',
        slots: {
          /**
           * The relay writes `name` on every channel it emits a `39000` for.
           * For a Folder created by Ship it is `project-<uuid-prefix>`, which
           * is ugly and is still the honest answer: it is what the object is
           * called. Peek's own topics carry the name a person typed.
           */
          title: { tag: 'name' },
          /**
           * `truncate` is safe here in a way it was not on Ship's `content`
           * (PRO-8): a tag value is a plain string by construction, so there is
           * no markup to cut through. The distinction is the whole reason
           * `truncate` survived on the tag variant and died on the field one.
           */
          subtitle: { tag: 'about', truncate: 120 },
          /**
           * The messages in this topic.
           *
           * `match: 'identifier'` because a message names its channel with `h`,
           * and `h` holds the **bare uuid** — this topic's `d`, not its address.
           * Ship's issues name their project by full address, which is why the
           * default is `address` and why this needed saying at all.
           */
          list: {
            children: { kind: MESSAGE_KIND, via: 'h', match: 'identifier', limit: 50 },
          },
        },
      },
      [MESSAGE_KIND]: {
        /**
         * **The first real use of the fallback chain** (RFC 0.4 §13.3).
         *
         * A message is none of `card`, `row`, `table` or `stat` — it is an
         * avatar, a name, a time and a body, and every app that has ever shown
         * one draws it that way. So it declares `message` and terminates in
         * `card`, which is the closest of the four and renders something
         * truthful in a consumer that has never heard of `message`.
         */
        widget: ['message', 'card'],
        slots: {
          /**
           * **A message has no title, and `title` is the one required slot.**
           *
           * The body cannot be it: message content carries structure in 41% of
           * production events, and truncating structure into a summary is
           * precisely what PRO-8 took out of Ship's manifest. What identifies a
           * message to a reader is *who wrote it*, so that is the title — which
           * needed `field: "pubkey"`, because no slot source could name the
           * event's author before this.
           */
          title: { field: 'pubkey', as: 'pubkey' },
          /**
           * The body, declared as `body` rather than `subtitle` for the reason
           * §13.3 separates them: `subtitle` promises plain text, and this is
           * not plain text. A consumer that has not implemented `body` drops it
           * and still renders an attributed message, which is the ignore-unknown
           * -slots guarantee doing its job on the first manifest to rely on it.
           *
           * No `truncate`. Same rule as PRO-8: this field carries structure.
           */
          body: { field: 'content' },
        },
      },
    },

    /**
     * **One action, and it is the only one of four that can be declared
     * honestly** (INT-9).
     *
     * Peek becomes a *producer of actions* here, having been a producer of
     * projections since PRO-6. What another app may do to a Peek object is now
     * a thing Peek says out loud rather than a thing nobody could ask.
     *
     * ## Why this one and not the obvious ones
     *
     * **Reply** still cannot be declared, for the reason this comment gave
     * before it listed anything: a reply is a `kind:9` carrying `h` plus an
     * `e` tag naming the event it answers, and `setTag`/`toAddressOf` can name
     * a parent *address* only. Declaring it with the tags that exist would tell
     * a consumer to publish a malformed reply. **Reacting** has the same shape
     * and a second problem — a `kind:7` carries no `h`, so a consumer
     * publishing one puts it where Peek cannot find it (RFC 0.4 §7.2). Both
     * belong with the conversation work.
     *
     * **Create a topic** cannot be declared either, and that one is not about
     * tags: a topic *is* a container, so creating one creates a Folder that
     * does not exist yet. `buildCreationEvent` emits one event into a Folder
     * that already exists. That is FOL-2, and PRO-18's steer is to wait for the
     * folder model rather than invent a shape it then contradicts.
     *
     * Starting a conversation creates no container and names no event id, which
     * is what leaves it declarable.
     *
     * ## The two halves that had to land first
     *
     * 1. **A message's body cannot be a tag.** Every declared property becomes
     *    one, and a `kind:9` carrying its text in a tag is not a message. So
     *    `message` declares `target: 'content'` — interop 0.13.0, and this is
     *    its first use by any producer.
     * 2. **A topic named no Folder a consumer could find.** Measured on
     *    production 2026-09-08: 0 of 40 `kind:39000` events carry `h` or
     *    `buzz-channel`. A consumer resolves the Folder to write into off the
     *    object it is acting on, so every write aimed at a topic was refused
     *    for having nowhere to go. interop 0.16.0 reads the `d` of a channel
     *    record, which is the channel id by the relay's own definition.
     *
     * ## `toAddressOf` without a `setTag`, which is deliberate
     *
     * `setTag` is the tag the *child* carries to name its parent, and a message
     * carries none: it names its channel with `h`, which every created event
     * gets anyway. So `toAddressOf: 'self'` alone is the honest declaration —
     * *this hangs under the object it was invoked on*, and the containment is
     * the Folder rather than a pointer. A consumer reads it as "needs a parent
     * picked" and publishes no `a` tag, which is exactly right.
     *
     * The containment relation a consumer reads for its sidebar comes off the
     * `list` slot above, not from this action, so declaring it changes no
     * reader: `containmentFor` prefers a declared `list` and only falls back to
     * inferring one from an action. Worth stating because the inference would
     * get it wrong — it assumes an `a` tag, and a message uses `h`.
     */
    actions: ACTIONS,

    /** Nothing of Peek's is an enumerated field. */
    vocabularies: {},
  }
}

/**
 * The kinds this manifest handles, as NIP-89 `k` tags.
 *
 * These are what a consumer filters on to find it, so a manifest without them
 * is discoverable by nobody — the check PRO-6's done-when actually names.
 */
export const HANDLED_KINDS = [TOPIC_KIND, MESSAGE_KIND]

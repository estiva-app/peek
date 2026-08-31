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
/** The relay's own kind for a channel's discovery record. */
export const TOPIC_KIND = 39000
/** A message in a channel. NIP-29's, and not addressable — see below. */
export const MESSAGE_KIND = 9

export const MANIFEST_D_TAG = 'estiva-peek'

export function manifestContent() {
  return {
    name: 'Peek',
    about: 'Conversations',

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
     * **No actions, deliberately.**
     *
     * The obvious one is "reply", and it cannot be declared honestly yet. An
     * action emits an event the consumer signs and publishes, and a reply is a
     * `kind:9` carrying `h` plus an `e` tag pointing at what it answers — but
     * the action vocabulary has `setTag`/`toAddressOf` for naming a *parent
     * address*, and a reply names an *event id*. Declaring it with the tags
     * that exist would tell a consumer to publish a malformed reply.
     *
     * Reacting has the same shape and a second problem: a `kind:7` carries no
     * `h`, so a consumer publishing one would put it somewhere Peek cannot
     * find it (RFC 0.4 §7.2).
     *
     * Both belong with the conversation work rather than here. An empty list is
     * the honest declaration: a consumer may render this object and may not act
     * on it.
     */
    actions: [],

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

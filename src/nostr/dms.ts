/**
 * Opening a DM's channel on the relay, from the browser (DMS-3).
 *
 * The same three-step division as every other publish here — Convex shapes the
 * unsigned event, the browser signs and sends it, Convex records the fact — but
 * with the arrow reversed at the last step. A topic's channel uuid travels
 * *out*: Convex mints it and tells the browser what to create. A DM's travels
 * *back*: the relay mints it — `Uuid::new_v4()` in `create_dm` — and keys it by
 * a hash of the participant set, so nobody else gets to choose it, it cannot be
 * computed from the participants, and the answer to the publish is the only
 * place it exists.
 *
 * That keying is also why this needs no bookkeeping. Opening the same DM
 * twice always names the same channel, so "have these two people got a channel
 * already" is not a question worth asking — publish, and use what comes back.
 *
 * There is no `9007` here and there must not be: `41010` creates the channel
 * itself, and a create alongside it would be a second, differently-owned
 * channel for the same conversation.
 */
import type { StoredToken } from '@/auth/estivaId'
import { publishSigned, signViaEstivaId } from './bridge'
import { commandPayload, type UnsignedEvent } from '@estiva-app/protocol'

type DmOpenPlan =
  | { ok: true; unsigned: UnsignedEvent; dmId: string }
  | { ok: false; reason: string; expected?: boolean }

export interface DmChannelResult {
  ok: boolean
  channelUuid?: string
  reason?: string
  /** This was never going to publish, and saying so would be crying wolf. */
  expected?: boolean
}

export async function publishDmChannel(
  dmKey: string,
  relayUrl: string,
  token: StoredToken,
  api: {
    unsignedDmOpen: (args: { dmKey: string }) => Promise<DmOpenPlan>
    recordDmChannel: (args: { dmId: string; channelUuid: string }) => Promise<void>
  },
): Promise<DmChannelResult> {
  const plan = await api.unsignedDmOpen({ dmKey })
  if (!plan.ok) return { ok: false, reason: plan.reason, expected: plan.expected }

  const first = await publish(plan.unsigned, relayUrl, token)
  if (!first.ok) return { ok: false, reason: first.reason }

  let channelUuid = first.channelUuid
  /*
    The race this exists for, measured on production 2026-09-17.

    Two tabs opening the same DM in the same wall-clock second build the same
    event — same author, same `p` tag, same `created_at` to the second — and
    therefore the same event id. `persist_command_event` keys on that id, so the
    second one is answered `accepted:true`, `"duplicate: already processed"`,
    and **no channel uuid**: the relay never re-ran the handler, so it has
    nothing to tell. The losing tab is not in an error state; it simply has not
    been told the answer yet.

    A *distinct* event re-runs the handler and is answered in full, with
    `created:false` and the same uuid — the derivation makes that safe. One
    second into the future is the cheapest way to be distinct, and the relay
    accepts it (measured; it was worth measuring, because a relay refusing a
    future timestamp would have made the escape a wait instead).

    Once, not in a loop: a second collision would mean a third tab landed in the
    same second as the retry, and re-publishing forever to chase it is worse
    than leaving the row for the next open to fill in.
  */
  if (!channelUuid && first.duplicate) {
    const retry = await publish({ ...plan.unsigned, created_at: plan.unsigned.created_at + 1 }, relayUrl, token)
    if (!retry.ok) return { ok: false, reason: retry.reason }
    channelUuid = retry.channelUuid
  }

  if (!channelUuid) {
    return { ok: false, reason: 'the relay accepted the DM open but named no channel' }
  }
  // First write wins server-side, so the tab that lost the race writes nothing
  // and both agree — they were told the same uuid either way.
  await api.recordDmChannel({ dmId: plan.dmId, channelUuid })
  return { ok: true, channelUuid }
}

/** One signed `41010`, and the channel uuid out of its answer. */
async function publish(
  unsigned: UnsignedEvent,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: boolean; channelUuid?: string; duplicate?: boolean; reason?: string }> {
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'the relay refused the DM open' }
  const channelId = commandPayload(result)?.channel_id
  return {
    ok: true,
    channelUuid: typeof channelId === 'string' ? channelId : undefined,
    duplicate: result.duplicate,
  }
}

/**
 * A person's DMs, from the relay alone: which channels they have, opening one,
 * and which they have hidden (DMS-3, DMS-6, REM-3).
 *
 * ## A DM is named by the other person's pubkey
 *
 * The relay names a DM by its channel uuid; the app names one by the person it
 * is with, and since REM-3 that name is their pubkey — the key every app
 * shares, where it used to be a Convex id or `seedKey` only Peek could read.
 * The map between the two is the relay's own (`fetchDmChannels`, off each
 * channel's `39000`), so nothing here asks Convex anything.
 *
 * ## Opening a DM mints its channel
 *
 * `ensureChannel` publishes a `41010` for a person the relay has no DM with
 * yet, once per person per tab, and records the uuid the relay answers with.
 * It waits for the channel read to have answered: before that, "no channel" is
 * a guess, and a guess would publish for every DM that already has one.
 *
 * ## Only offer what can succeed
 *
 * `canHideDm` is false until two things are true: the DM has a channel (a
 * conversation nobody has opened has nothing on the relay to hide) and the
 * relay has said what is hidden (a hide sent before that answer would be
 * applied to a set this tab has not seen).
 *
 * ## Re-open is the unhide
 *
 * `reopenDm` publishes the same `kind:41010` that opened the channel; the relay
 * clears the viewer's `hidden_at` and republishes their snapshot. It is called
 * when the viewer opens a hidden DM (`useDmConversationView`), which is the one
 * gesture that unambiguously means "I want this back".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDmVisibilitySync } from '@/nostr/useDmVisibilitySync'
import { publishDmHide } from '@/nostr/dmVisibility'
import { fetchDmChannels, publishDmChannel } from '@/nostr/dms'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { RELAY_URL } from '@/api/relayUrl'

export interface DmChannelsValue {
  /** Whether the relay has said which DM channels exist. */
  state: 'unknown' | 'present'
  /** The channel uuid of the DM with this person, if there is one. */
  channelOf: (pubkey: string) => string | undefined
  /** Everyone the viewer has a DM channel with, by pubkey. */
  partners: readonly string[]
  /** Give the DM with this person a channel, if the relay says it has none. */
  ensureChannel: (pubkey: string) => void
}

export interface DmVisibilityValue {
  /** Whether the relay has said what is hidden. `unknown` hides nothing. */
  state: 'unknown' | 'present'
  isDmHidden: (pubkey: string) => boolean
  /** The DM has a channel and the relay has answered, so a hide can succeed. */
  canHideDm: (pubkey: string) => boolean
  /** Hide from this viewer's sidebar. Never throws; a failure is logged. */
  hideDm: (pubkey: string) => Promise<void>
  /** Bring a hidden DM back. Never throws; a failure is logged. */
  reopenDm: (pubkey: string) => Promise<void>
}

const DmsContext = createContext<{ channels: DmChannelsValue; visibility: DmVisibilityValue } | null>(null)

export function DmsProvider({ children }: { children: ReactNode }) {
  const relayUrl = RELAY_URL
  const { hidden, state: visibilityState, seam, applyHidden } = useDmVisibilitySync(relayUrl)
  const [byPartner, setByPartner] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [channelsState, setChannelsState] = useState<'unknown' | 'present'>('unknown')
  /** A read that lands after a channel was minted here must not drop it. */
  const minted = useRef<Map<string, string>>(new Map())
  const attempted = useRef<Set<string>>(new Set())
  /** The copy on the device draws only until the relay has answered once (PEE-2). */
  const relayAnswered = useRef(false)

  const read = useCallback(async () => {
    const current = seam()
    if (!current) return
    try {
      const result = await fetchDmChannels(current)
      if (result.state !== 'present') {
        console.warn('[dms] the relay did not say which DM channels exist')
        return
      }
      relayAnswered.current = true
      setByPartner(new Map([...minted.current, ...result.byPartner]))
      setChannelsState('present')
    } catch (error) {
      console.warn('[dms] could not read DM channels from the relay:', error)
    }
  }, [seam])

  useEffect(() => {
    // The channels the copy on the device holds, drawn until the relay's land
    // (PEE-2) — and never marked `present`, which only the relay may say.
    const current = seam()
    if (current) {
      void fetchDmChannels(current, 'copy').then((result) => {
        if (result.state === 'present' && !relayAnswered.current) setByPartner(new Map([...minted.current, ...result.byPartner]))
      })
    }
    void read()
  }, [read, seam])
  /*
    Focus and visibility, no interval. A DM somebody else opens with you is
    found the next time you come back to the tab; one indexed read at human
    frequency is the right price for that, and a 30 s poll across every open
    tab is not (PER-13's budget).
  */
  useRefreshTriggers(() => void read(), { enabled: !!relayUrl, interval: false })

  const record = useCallback((pubkey: string, channelUuid: string) => {
    minted.current.set(pubkey, channelUuid)
    setByPartner((prev) => (prev.get(pubkey) === channelUuid ? prev : new Map(prev).set(pubkey, channelUuid)))
  }, [])

  const channelOf = useCallback((pubkey: string) => byPartner.get(pubkey), [byPartner])
  const partners = useMemo(() => [...byPartner.keys()], [byPartner])

  const ensureChannel = useCallback(
    (pubkey: string) => {
      if (channelsState !== 'present' || byPartner.has(pubkey)) return
      if (attempted.current.has(pubkey)) return
      const current = seam()
      if (!current || current.pubkey === pubkey) return
      attempted.current.add(pubkey)
      // Once per person per tab. A publish that fails leaves the DM without a
      // channel until the next load, which is the bargain every publish here
      // makes: a retry loop against a relay that is refusing is worse than a gap.
      void publishDmChannel(pubkey, current)
        .then((result) => {
          if (result.ok && result.channelUuid) record(pubkey, result.channelUuid)
          else console.warn('[dms] DM channel open failed:', result.reason)
        })
        .catch((error) => console.warn('[dms] DM channel open failed:', error))
    },
    [channelsState, byPartner, seam, record],
  )

  const isDmHidden = useCallback(
    (pubkey: string) => {
      const channel = byPartner.get(pubkey)
      return channel !== undefined && hidden.has(channel)
    },
    [byPartner, hidden],
  )

  const canHideDm = useCallback(
    // The channel as the relay named it, never as the copy on the device remembers it (PEE-2).
    (pubkey: string) =>
      visibilityState === 'present' && channelsState === 'present' && byPartner.has(pubkey) && !isDmHidden(pubkey),
    [visibilityState, channelsState, byPartner, isDmHidden],
  )

  const hideDm = useCallback(
    async (pubkey: string) => {
      const current = seam()
      const channel = byPartner.get(pubkey)
      if (!current || !channel || channelsState !== 'present') {
        console.warn('[dms] not hidden: no channel the relay has named, no relay origin or no live Estiva ID token in this tab')
        return
      }
      try {
        const result = await publishDmHide(channel, current)
        if (result.ok) await applyHidden(channel, true)
        else console.warn('[dms] hide failed:', result.reason)
      } catch (error) {
        console.warn('[dms] hide threw:', error)
      }
    },
    [seam, byPartner, channelsState, applyHidden],
  )

  const reopenDm = useCallback(
    async (pubkey: string) => {
      const current = seam()
      const channel = byPartner.get(pubkey)
      if (!current || !channel) return
      try {
        const result = await publishDmChannel(pubkey, current)
        if (result.ok) await applyHidden(channel, false)
        else console.warn('[dms] re-open failed:', result.reason)
      } catch (error) {
        console.warn('[dms] re-open threw:', error)
      }
    },
    [seam, byPartner, applyHidden],
  )

  const value = useMemo(
    () => ({
      channels: { state: channelsState, channelOf, partners, ensureChannel },
      visibility: { state: visibilityState, isDmHidden, canHideDm, hideDm, reopenDm },
    }),
    [channelsState, channelOf, partners, ensureChannel, visibilityState, isDmHidden, canHideDm, hideDm, reopenDm],
  )

  return <DmsContext.Provider value={value}>{children}</DmsContext.Provider>
}

function useDms() {
  const ctx = useContext(DmsContext)
  if (!ctx) throw new Error('DM hooks must be used inside DmsProvider')
  return ctx
}

export function useDmChannels(): DmChannelsValue {
  return useDms().channels
}

export function useDmVisibility(): DmVisibilityValue {
  return useDms().visibility
}

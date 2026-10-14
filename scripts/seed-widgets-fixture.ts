/**
 * Seed "Widgets probe" in the QA Folder: the topic `scripts/probe-switch.mjs --a
 * "Widgets probe"` opens to see whether a conversation stays still while its
 * cards, chips and images fill in (OPT-10).
 *
 * Forty plain messages, then — among the last few, so they sit on screen when
 * the topic opens at the bottom and push the messages below them if they grow —
 * three messages whose authors chose a card (SPEC §13.6.2: a Ship issue as
 * compact, the Widgets project as detailed, "Switch probe A" as detailed), one
 * with a chip in its sentence, and one with an image. Three plain messages
 * close it, so the message the probe watches is below all of them.
 *
 * Written through Peek's own write paths as QA-1 and QA-2, like the switch
 * fixture, so the events are what the composer sends. Resumable: it counts the
 * top-level messages already there and writes only the rest.
 *
 *   node scripts/run-in-vite.mjs scripts/seed-widgets-fixture.ts [--dry-run]
 *   node scripts/run-in-vite.mjs scripts/seed-widgets-fixture.ts --live "Live card <time>" | --clean
 */
import { deflateSync } from 'node:zlib'
import { encodeNaddr, uploadBlob } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { queryRelay, signViaEstivaId } from '@/nostr/bridge'
import { createTopicAsViewer } from '@/nostr/foreign'
import { commentAsViewer, deleteEventAsViewer, type OutgoingAttachment } from '@/nostr/fileConversation'
import { qaToken } from './seed-switch-fixture'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const TITLE = 'Widgets probe'
const PACE_MS = Number(process.env.PACE_MS ?? 1500)
/** OPT-10, a Ship issue, and the Widgets project it is in. */
const SHIP_ISSUE = '30851:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:79130ca5-b4bc-48fb-9f70-85d62576ca23'
const SHIP_PROJECT = '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:4fdb6017-d6ae-4827-8b9f-23a18c9272c0'
/** OPT-20, for the live message's card. */
const LIVE_ISSUE = '30851:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:0ce67ecf-1fe3-42c1-9ce6-a36746cda190'

const dryRun = process.argv.includes('--dry-run')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const naddrOf = (address: string) => {
  const [kind, pubkey, identifier] = address.split(':')
  return `nostr:${encodeNaddr({ kind: Number(kind), pubkey, identifier, relays: [] })}`
}

/** A 480×320 PNG, a diagonal gradient: an image with no metadata for the store to strip. */
function gradientPng(width = 480, height = 320): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      rows[row + 1 + x * 3] = Math.round((x / width) * 255)
      rows[row + 2 + x * 3] = Math.round((y / height) * 255)
      rows[row + 3 + x * 3] = 160
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]))
}

async function topicAddress(title: string, owner: StoredToken): Promise<string | undefined> {
  const found = await queryRelay(RELAY_URL, [{ kinds: [30840], '#h': [QA_FOLDER], limit: 500 }], owner.accessToken, owner.pubkey)
  if (!found.ok) throw new Error(`topic read refused: ${found.reason}`)
  const existing = found.events.find((e) => e.tags.some((t) => t[0] === 'title' && t[1] === title))
  return existing && `30840:${existing.pubkey}:${existing.tags.find((t) => t[0] === 'd')?.[1]}`
}

async function uploadImage(token: StoredToken): Promise<OutgoingAttachment> {
  const blob = await uploadBlob({
    relayUrl: RELAY_URL,
    bytes: gradientPng().buffer as ArrayBuffer,
    contentType: 'image/png',
    filename: 'gradient.png',
    sign: (unsigned) => signViaEstivaId(unsigned, token.accessToken, token.pubkey),
    pubkey: token.pubkey,
  })
  return { name: 'gradient.png', contentType: blob.type || 'image/png', size: blob.size, sha256: blob.sha256, mediaUrl: blob.url, thumbUrl: blob.thumb }
}

export default async function main() {
  const people: [StoredToken, StoredToken] = [await qaToken(1), await qaToken(2)]
  const [qa1] = people
  const switchA = await topicAddress('Switch probe A', qa1)
  if (!switchA) throw new Error('"Switch probe A" not found: run seed-switch-fixture.ts first')

  let address = await topicAddress(TITLE, qa1)
  if (!address) {
    if (dryRun) address = `30840:${qa1.pubkey}:dry-run`
    else {
      const created = await createTopicAsViewer({ folder: QA_FOLDER, title: TITLE, hasState: false }, RELAY_URL, qa1)
      if (!created.ok) throw new Error(`create ${TITLE}: ${created.reason}`)
      address = created.address
      await sleep(PACE_MS)
    }
  }
  console.log(`${TITLE}: ${address}`)
  const container = { kind: 'file' as const, address, h: QA_FOLDER }

  /*
    `--live <text>`: one message from QA-2 with a detailed card, sent while QA-1 watches (probe-steady.mjs). Of
    an issue drawn nowhere else in the topic, so the watching tab has not loaded it yet.
  */
  const live = process.argv.indexOf('--live')
  if (live !== -1) {
    const body = `${process.argv[live + 1]} ${naddrOf(LIVE_ISSUE)}`
    const result = await commentAsViewer({ container, body, embeds: [{ value: LIVE_ISSUE, layout: 'detailed' }] }, RELAY_URL, people[1])
    console.log(result.ok ? 'posted' : `not posted: ${result.reason}`)
    return
  }
  // `--clean`: delete those, so the last screen stays the fixture's own cards, chip and image.
  if (process.argv.includes('--clean')) {
    const sent = await queryRelay(RELAY_URL, [{ kinds: [1111], '#A': [address], authors: [people[1].pubkey], limit: 500 }], qa1.accessToken, qa1.pubkey)
    if (!sent.ok) throw new Error(`#A read refused: ${sent.reason}`)
    for (const event of sent.events.filter((e) => e.content.startsWith('Live card'))) {
      const result = await deleteEventAsViewer(event.id, RELAY_URL, people[1])
      console.log(result.ok ? `deleted ${event.id.slice(0, 8)}` : `not deleted: ${result.reason}`)
    }
    return
  }

  type Message = { body: string; embeds?: { value: string; layout: 'compact' | 'detailed' }[]; image?: true }
  const messages: Message[] = Array.from({ length: 40 }, (_, i) => ({
    body: `Message ${i + 1} in ${TITLE}.${i % 7 === 0 ? ' A longer one, so rows are not all one height: the quick brown fox jumps over the lazy dog, twice.' : ''}`,
  }))
  messages.push(
    { body: `Message 41: the ticket, as a row — ${naddrOf(SHIP_ISSUE)}`, embeds: [{ value: SHIP_ISSUE, layout: 'compact' }] },
    { body: `Message 42: plain, between the cards.` },
    { body: `Message 43: the project, as a card — ${naddrOf(SHIP_PROJECT)}`, embeds: [{ value: SHIP_PROJECT, layout: 'detailed' }] },
    { body: `Message 44: the other topic, as a card — ${naddrOf(switchA)}`, embeds: [{ value: switchA, layout: 'detailed' }] },
    { body: `Message 45: a chip in a sentence, ${naddrOf(SHIP_ISSUE)}, and no card.` },
    { body: `Message 46: an image.`, image: true },
    { body: `Message 47: plain, below everything that loads.` },
    { body: `Message 48: plain, below everything that loads.` },
    { body: `Message 49: the last one.` },
  )

  const read = await queryRelay(RELAY_URL, [{ kinds: [1111], '#A': [address], limit: 500 }], qa1.accessToken, qa1.pubkey)
  if (!read.ok) throw new Error(`#A read refused: ${read.reason}`)
  const done = Math.max(0, ...read.events.map((e) => Number(/^Message (\d+)/.exec(e.content)?.[1] ?? 0)))
  console.log(`${done} of ${messages.length} already written`)

  for (let i = done; i < messages.length; i++) {
    const { body, embeds, image } = messages[i]
    const author = people[i % 2]
    if (dryRun) {
      console.log(`dry-run #${i + 1}: ${body.slice(0, 60)}${embeds ? ` embeds=${JSON.stringify(embeds)}` : ''}${image ? ' +image' : ''}`)
      continue
    }
    const files = image ? [await uploadImage(author)] : undefined
    const result = await commentAsViewer({ container, body, ...(embeds ? { embeds } : {}), ...(files ? { files } : {}) }, RELAY_URL, author)
    if (!result.ok) throw new Error(`#${i + 1}: ${result.reason}`)
    await sleep(PACE_MS)
  }
  console.log('done')
}

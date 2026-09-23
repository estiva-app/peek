/**
 * Make an MP4 or a WebP acceptable to the relay without re-encoding it — CON-5.
 *
 * Three of the 62 Convex-only attachments were refused on upload, each for a
 * structural reason the relay's `buzz-media` validation states exactly:
 *
 *   - **an MP4 with a `udta`** carrying an `ilst` (ffmpeg's encoder tag).
 *     `validate_mp4_metadata_free` allows `udta` only as ffmpeg's *empty* form.
 *   - **an MP4 whose `moov` follows its `mdat`** — `check_moov_before_mdat`,
 *     "not fast-start".
 *   - **a WebP with an `ICCP` chunk**, flagged in `VP8X`. `EXIF` and `XMP `
 *     are refused the same way.
 *
 * Peek's composer never met these because the files predate it or came from
 * elsewhere, and `canonicalizeImage` covers PNG and JPEG only.
 *
 * ## Lossless, and proven so
 *
 * Nothing here touches a sample. An MP4 is rebuilt as `ftyp`, then `moov` with
 * the `udta` removed, then every other top-level box in its original order, and
 * each `stco`/`co64` entry is moved by however far its `mdat` moved. Then
 * {@link sanitizeMp4} checks the claim it depends on: the bytes at every chunk
 * offset in the output equal the bytes at the matching offset in the input.
 * A WebP loses its metadata chunks and the matching `VP8X` flags; the `VP8 ` /
 * `VP8L` / `ALPH` payloads are copied byte for byte.
 *
 * Dropping an ICC profile is the one change a viewer could see: the pixels are
 * then read as sRGB. The relay refuses every profile, so there is no form of
 * this file it would accept that keeps one.
 */

/** Boxes the walk descends into — `buzz-media`'s `CONTAINERS`. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'sinf', 'schi'])
/** Boxes removed wherever they appear. `udta` is the only one these files carry; the rest are `FORBIDDEN` there. */
const DROP = new Set(['udta', 'meta', 'ilst', 'keys', 'uuid', 'xml ', 'bxml', 'loci', 'name', 'chap'])

interface Box {
  kind: string
  /** Offset of the box in the source file. */
  start: number
  size: number
  header: number
  children?: Box[]
}

function readBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Box[] = []
  for (let off = start; off < end; ) {
    if (end - off < 8) throw new Error(`truncated box at ${off}`)
    let size = dv.getUint32(off)
    const kind = String.fromCharCode(...b.subarray(off + 4, off + 8))
    let header = 8
    if (size === 1) {
      size = Number(dv.getBigUint64(off + 8))
      header = 16
    } else if (size === 0) size = end - off
    if (size < header || off + size > end) throw new Error(`bad ${kind} box at ${off}`)
    const box: Box = { kind, start: off, size, header }
    if (CONTAINERS.has(kind)) box.children = readBoxes(b, off + header, off + size)
    out.push(box)
    off += size
  }
  return out
}

/** A box re-serialised with its dropped descendants gone. A compact header is kept compact. */
function serialise(b: Uint8Array, box: Box): Uint8Array {
  if (!box.children) return b.slice(box.start, box.start + box.size)
  const parts = box.children.filter((c) => !DROP.has(c.kind)).map((c) => serialise(b, c))
  const bodyLen = parts.reduce((n, p) => n + p.length, 0)
  if (box.header !== 8 || bodyLen + 8 > 0xffffffff) throw new Error(`${box.kind}: extended-size container not handled`)
  const out = new Uint8Array(8 + bodyLen)
  new DataView(out.buffer).setUint32(0, 8 + bodyLen)
  out.set(b.subarray(box.start + 4, box.start + 8), 4)
  let at = 8
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Every `stco`/`co64` table in a serialised `moov`, found by walking it again. */
function chunkTables(moov: Uint8Array): Array<{ at: number; wide: boolean; count: number }> {
  const found: Array<{ at: number; wide: boolean; count: number }> = []
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const walk = (boxes: Box[]) => {
    for (const x of boxes) {
      if (x.children) walk(x.children)
      if (x.kind === 'stco' || x.kind === 'co64') {
        // full box: version/flags (4), entry_count (4), entries
        const body = x.start + x.header
        found.push({ at: body + 8, wide: x.kind === 'co64', count: dv.getUint32(body + 4) })
      }
    }
  }
  walk(readBoxes(moov, 0, moov.length))
  return found
}

export function sanitizeMp4(input: Uint8Array): Uint8Array {
  const top = readBoxes(input, 0, input.length)
  const ftyp = top[0]
  if (ftyp?.kind !== 'ftyp') throw new Error('MP4 does not start with ftyp')
  const moovBox = top.find((x) => x.kind === 'moov')
  if (!moovBox) throw new Error('MP4 has no moov')
  const unexpected = top.filter((x) => !['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'].includes(x.kind))
  if (unexpected.length) throw new Error(`unexpected top-level box ${unexpected[0].kind}`)

  const moov = serialise(input, moovBox)
  const rest = top.filter((x) => x !== ftyp && x !== moovBox)

  // New position of each remaining top-level box, so each mdat's shift is known.
  const shifts: Array<{ from: number; to: number; delta: number }> = []
  let at = ftyp.size + moov.length
  for (const x of rest) {
    if (x.kind === 'mdat') shifts.push({ from: x.start, to: x.start + x.size, delta: at - x.start })
    at += x.size
  }
  const shiftOf = (offset: number) => {
    const s = shifts.find((m) => offset >= m.from && offset < m.to)
    if (!s) throw new Error(`chunk offset ${offset} is in no mdat`)
    return s.delta
  }

  const tables = chunkTables(moov)
  const mv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const moved: Array<[number, number]> = []
  for (const t of tables) {
    for (let i = 0; i < t.count; i++) {
      const p = t.at + i * (t.wide ? 8 : 4)
      const old = t.wide ? Number(mv.getBigUint64(p)) : mv.getUint32(p)
      const next = old + shiftOf(old)
      if (t.wide) mv.setBigUint64(p, BigInt(next))
      else if (next > 0xffffffff) throw new Error('chunk offset overflows stco')
      else mv.setUint32(p, next)
      moved.push([old, next])
    }
  }

  const out = new Uint8Array(at)
  out.set(input.subarray(0, ftyp.size), 0)
  out.set(moov, ftyp.size)
  let w = ftyp.size + moov.length
  for (const x of rest) {
    out.set(input.subarray(x.start, x.start + x.size), w)
    w += x.size
  }

  // The claim this rests on: every chunk begins with the same bytes it did.
  for (const [old, next] of moved) {
    const n = Math.min(64, input.length - old)
    for (let i = 0; i < n; i++) if (input[old + i] !== out[next + i]) throw new Error(`chunk at ${old} → ${next} differs`)
  }
  const mdatIn = top.filter((x) => x.kind === 'mdat').reduce((n, x) => n + x.size, 0)
  const mdatOut = readBoxes(out, 0, out.length).filter((x) => x.kind === 'mdat').reduce((n, x) => n + x.size, 0)
  if (mdatIn !== mdatOut) throw new Error('mdat size changed')
  return out
}

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'])
/** VP8X flags for ICC (0x20), EXIF (0x08) and XMP (0x04). */
const WEBP_METADATA_FLAGS = 0x20 | 0x08 | 0x04

export function sanitizeWebp(input: Uint8Array): Uint8Array {
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const tag = (o: number) => String.fromCharCode(...input.subarray(o, o + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('not a WebP')
  const parts: Uint8Array[] = []
  for (let i = 12; i < input.length; ) {
    if (i + 8 > input.length) throw new Error(`truncated chunk at ${i}`)
    const kind = tag(i)
    const len = dv.getUint32(i + 4, true)
    const end = i + 8 + len + (len & 1)
    if (end > input.length) throw new Error(`bad ${kind} chunk at ${i}`)
    if (kind === 'ANMF') throw new Error('animated WebP frames not handled')
    if (WEBP_KEEP.has(kind)) {
      const chunk = input.slice(i, end)
      if (kind === 'VP8X') chunk[8] &= ~WEBP_METADATA_FLAGS
      parts.push(chunk)
    }
    i = end
  }
  const body = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(12 + body)
  out.set(input.subarray(0, 12), 0)
  new DataView(out.buffer).setUint32(4, 4 + body, true)
  let w = 12
  for (const p of parts) {
    out.set(p, w)
    w += p.length
  }
  return out
}

/** The relay-acceptable form of a file, or the file itself when it is neither an MP4 nor a WebP. */
export function sanitizeForRelay(bytes: ArrayBuffer, contentType: string): ArrayBuffer {
  const input = new Uint8Array(bytes)
  const out = contentType === 'video/mp4' ? sanitizeMp4(input) : contentType === 'image/webp' ? sanitizeWebp(input) : null
  return out ? (out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer) : bytes
}

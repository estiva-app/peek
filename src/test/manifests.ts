/**
 * The apps' manifests (`kind:31990`) as production holds them on 24 Nov 2026,
 * for tests that need the words links are written and read with (LIN-3). The
 * same shapes as the shared package's own tests (interop's file-link.test.ts),
 * so a link a test expects is the link production writes.
 */
import type { LinkManifest } from '@estiva-app/interop'

export const PEEK_KEY = 'a'.repeat(64)
export const SHIP_KEY = 'b'.repeat(64)
export const LEAF_KEY = 'c'.repeat(64)

export const PEEK_MANIFEST: LinkManifest = {
  pubkey: PEEK_KEY,
  created_at: 1_793_000_000,
  content: JSON.stringify({ aspect: 'conversation' }),
  tags: [
    ['d', 'estiva-peek'],
    ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', '1111'],
    ['urls', 'https://peek.estiva.app/topic-old/<slug>-<d>', '39000'],
    ['urls', 'https://peek.estiva.app/message/<id>', '9'],
  ],
}

export const SHIP_MANIFEST: LinkManifest = {
  pubkey: SHIP_KEY,
  created_at: 1_793_500_000,
  content: JSON.stringify({ projections: { 30850: {}, 30851: {} } }),
  tags: [
    ['d', 'estiva-ship'],
    ['k', '30850'],
    ['k', '30851'],
    ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
    ['urls', 'https://ship.estiva.app/#/project/<d>', '30850'],
    ['urls', 'https://ship.estiva.app/#/issue/<d>', '30851'],
  ],
}

export const LEAF_MANIFEST: LinkManifest = {
  pubkey: LEAF_KEY,
  created_at: 1_795_000_000,
  content: JSON.stringify({ projections: { 30842: {} } }),
  tags: [
    ['d', 'estiva-leaf'],
    ['k', '30842'],
    ['web', 'https://leaf.estiva.app/f/<bech32>', 'naddr'],
    ['urls', 'https://leaf.estiva.app/document/<slug>-<d>#block-<block>', '30842'],
  ],
}

export const PRODUCTION_MANIFESTS: readonly LinkManifest[] = [LEAF_MANIFEST, SHIP_MANIFEST, PEEK_MANIFEST]

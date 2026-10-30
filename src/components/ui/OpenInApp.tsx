import type { ForeignObject } from '@estiva-app/interop'
import { Link } from '@estiva-app/ui'
import { openInAppUrl } from '@/lib/appName'
import { WithTooltip } from './WithTooltip'

/**
 * "Open in <app>" — the way out of Peek to the app that owns a file.
 *
 * The URL comes from the owning app's NIP-89 `web` tag, already substituted
 * server-side. Peek does not construct it and does not know what it points at:
 * without the manifest there would be no link, because there is nothing in an
 * naddr that says where a human should go to see the thing.
 *
 * `noopener` because this is a URL a stranger published into a shared relay,
 * and http(s) only for the same reason (`openInAppUrl`).
 *
 * The file page's header draws it: its card is in a column that starts
 * closed, and the header says just "Open ↗" — *"I would simplify and just say
 * Open. Less words is better. it's more clear."* (Miky, 2026-10-14). Where it
 * goes, "Open in <app>", stays its accessible name and its tooltip, so a screen
 * reader and a hover still say which app.
 */
export function OpenInApp({ object }: { object: Pick<ForeignObject, 'openUrl' | 'appName'> }) {
  const href = openInAppUrl(object)
  if (!href) return null
  const where = `Open in ${object.appName ?? 'app'}`
  return (
    <WithTooltip label={where} inline>
      <Link href={href} variant="underlined" external aria-label={where}>
        Open ↗
      </Link>
    </WithTooltip>
  )
}

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { InlineChip, ToastProvider, useToast } from '@estiva-app/ui'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ShipLogoMark } from '@/components/ui/ShipLogo'
import { TopicState } from '@/components/ui/TopicState'
import { THREAD } from './data'
import { LauncherPrototype, type ProtoContext } from './LauncherPrototype'

/**
 * UIG-29 — a proposal for the whole launcher, to click through. Not the build.
 *
 * Base UI Dialog + Autocomplete (inline), drawn with Peek's parts, on invented
 * data. Every relay read and every model answer is a timer. Ctrl+K opens and
 * closes it; the page behind shows what a result, a draft or a created issue
 * would do.
 */
interface PageArgs {
  context: ProtoContext
  slow?: boolean
  failCreate?: boolean
  escGoesBack?: boolean
}

function Page({ context, slow, failCreate, escGoesBack }: PageArgs) {
  const [open, setOpen] = useState(true)
  const [inserted, setInserted] = useState<string | null>(null)
  const [created, setCreated] = useState<{ key: string; title: string } | null>(null)
  const [went, setWent] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const inThread = context.from !== 'nowhere'

  return (
    <div className="flex h-screen gap-4 bg-bg-base p-4">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
          {inThread ? (
            <>
              <TopicState type="topic" status="unresolved" />
              <span className="text-body-2-strong text-text-primary">Feedback on the launcher</span>
            </>
          ) : (
            <span className="text-body-2-strong text-text-primary">Desk</span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
          {inThread ? (
            THREAD.map((m) => (
              <div key={m.id} className="flex gap-3">
                <Avatar name={m.author} size={28} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-caption text-text-secondary">
                    {m.author} · {m.time}
                  </span>
                  <p className="text-body-2 text-text-primary">{m.body}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-body-2 text-text-secondary">Nothing is open. The launcher searches everything and offers the apps.</p>
          )}

          {created && (
            <div className="flex flex-col gap-2">
              <span className="text-caption text-text-muted">Katerina Kelepouri created an issue in Ship · just now</span>
              <div className="flex max-w-md items-center gap-3 rounded-lg border border-border-default bg-bg-inset p-3">
                <ShipLogoMark height={16} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-caption text-text-secondary">{created.key} · Todo · Launcher polish</span>
                  <span className="truncate text-body-2 text-text-primary">{created.title}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {inThread && (
          <div className="m-4 mt-0 flex flex-col gap-2 rounded-lg border border-border-default bg-bg-inset p-3">
            <span className="text-caption text-text-muted">{context.from === 'reply' ? 'Reply to Amie' : 'Message #Feedback on the launcher'}</span>
            <div className="min-h-6 text-body-2 text-text-primary">
              {inserted && <span>{inserted} </span>}
              {created && (
                <InlineChip icon={<ShipLogoMark height={10} />}>
                  {created.key} {created.title}
                </InlineChip>
              )}
              {!inserted && !created && <span className="text-text-muted">Write a reply…</span>}
            </div>
          </div>
        )}
      </div>

      <aside className="flex w-60 shrink-0 flex-col gap-3 p-2">
        <Button variant="outlined" onClick={() => setOpen(true)}>
          Open launcher (Ctrl+K)
        </Button>
        <p className="text-caption text-text-secondary">Prototype. Invented data; every relay read and model answer is a timer.</p>
        {went && <p className="text-caption text-text-primary">Last opened: {went}</p>}
      </aside>

      <LauncherPrototype
        context={context}
        open={open}
        onOpenChange={setOpen}
        slow={slow}
        failCreate={failCreate}
        escGoesBack={escGoesBack}
        onNavigate={(where) => setWent(where)}
        onInsert={(text) => {
          setInserted(text)
          showToast({ label: 'Put in the composer. It will not send until you do.', type: 'neutral' })
        }}
        onCreated={(issue) => {
          setCreated(issue)
          showToast({ label: `${issue.key} created in Ship`, type: 'success', actionLabel: 'Open', onAction: () => setWent(issue.key) })
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Prototypes/Launcher proposal',
  component: Page,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** Reading a topic: the conversation's actions come first, then recents and apps. */
export const FromATopic: Story = {
  args: { context: { from: 'topic', label: '#Feedback on the launcher' } },
}

/** Writing a reply: Draft a reply joins Ask and Make. */
export const ReplyingInAThread: Story = {
  args: { context: { from: 'reply', label: 'a reply to Amie' } },
}

/** Opened from the Desk with nothing open: search, recents and apps only. */
export const FromNowhere: Story = {
  args: { context: { from: 'nowhere' } },
}

/** The relay and the model answer slowly, as against production. */
export const SlowRelayAndModel: Story = {
  args: { context: { from: 'reply', label: 'a reply to Amie' }, slow: true },
}

/** The other way to go back: Esc steps back one level, and closes only from the first (Raycast's default). */
export const EscGoesBack: Story = {
  args: { context: { from: 'reply', label: 'a reply to Amie' }, escGoesBack: true },
}

/** Ship refuses the new issue: the form stays, with the reason. */
export const CreateFails: Story = {
  args: { context: { from: 'topic', label: '#Feedback on the launcher' }, failCreate: true },
}

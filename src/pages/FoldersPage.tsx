import { useEffect, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { FolderContentsView } from '@/components/views/FolderContentsView'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import {
  useFolderContents,
  useFolders,
  useForeignConversation,
  useForeignObjects,
  useWorkspaceDirectory,
} from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/lib/toast'

/**
 * `/folders` and `/folders/:id` — navigation by Folder (RFC 0.4 §4).
 *
 * **Added beside the topic model, not on top of it.** Peek's topic routes,
 * `useTopicPath` and the whole `@/api` topic seam are untouched: a Folder is a
 * second way into the same relay, and RFC 0.4 §11.1 is explicit that turning
 * topics into files under Folders is a separate and much larger change. This
 * page reads Folders and draws what is in them; nothing about a topic moves.
 *
 * The left pane lists Folders by name; the right draws one Folder's contents,
 * whichever apps own them.
 */
export function FoldersPage() {
  const { folders, signedOut, reload } = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { state } = useFolderContents(id)
  const { createFolder } = useForeignObjects()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  /*
    Which file's conversation is open — RFC 0.5 §10.

    The file itself rather than its `ref`, because the panel needs the `naddr`
    to resolve by and the title to head the pane with, and the row already holds
    both. Looking them up again from `state` would also go stale the moment the
    contents re-read.
  */
  const [openFile, setOpenFile] = useState<ForeignObject | null>(null)
  const { state: conversation } = useForeignConversation(openFile?.naddr)
  const people = useWorkspaceDirectory()

  const selected = folders?.find((folder) => folder.id === id)

  /*
    Changing Folder closes the panel.

    Without this the previous Folder's file stays open beside the new Folder's
    contents — a conversation the list on screen does not contain, which reads
    as though it belongs to something here.
  */
  useEffect(() => setOpenFile(null), [id])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    const result = await createFolder(trimmed)
    setCreating(false)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'neutral' })
      return
    }
    setName('')
    /*
      Re-read before navigating. The relay emits the `kind:39000` this list
      reads as a side effect of accepting the create, so it exists by the time
      the publish returns — but the list in this component does not, and
      navigating first would land on a Folder the sidebar cannot show.
    */
    await reload()
    navigate(`/folders/${result.id}`)
  }

  return (
    <AppShell
      leftPanel={
        <div className="flex h-full flex-col">
          <ContainerHeader title="Folders" />
          {!signedOut && (
            <div className="flex items-center gap-2 px-3 pb-2">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  // The one key handler here, and it is the package's input's
                  // own submit affordance rather than a hand-rolled shortcut.
                  if (event.key === 'Enter') void create()
                }}
                placeholder="New folder name"
                aria-label="New folder name"
              />
              <Button onClick={() => void create()} disabled={!name.trim() || creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          )}
          {/*
            Three states, not two. "Not signed in", "still loading" and "there
            are genuinely none" are different sentences, and the first version
            of this page told a signed-out viewer "No folders yet" about a
            workspace holding eighty-one of them.
          */}
          {signedOut ? (
            <EmptyState message="Sign in to see folders." />
          ) : folders === null ? (
            <EmptyState message="Loading folders…" />
          ) : folders.length === 0 ? (
            <EmptyState message="No folders yet." />
          ) : (
            <div className="flex flex-col gap-0.5">
              {folders.map((folder) => (
                <PersonRow
                  key={folder.id}
                  /*
                    The id when there is no name. A Folder with no state event
                    has only its channel's name, and a channel created by an app
                    rather than a person may carry none — so this is the ordinary
                    case on today's data, not a defensive branch.
                  */
                  name={folder.name ?? folder.id}
                  isSelected={folder.id === id}
                  onClick={() => navigate(`/folders/${folder.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      }
      rightPanel={
        id ? (
          <div className="flex h-full flex-col">
            <ContainerHeader title={selected?.name ?? 'Folder'} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FolderContentsView
                state={state}
                selectedRef={openFile?.ref}
                onSelect={setOpenFile}
              />
            </div>
          </div>
        ) : (
          <EmptyState message="Select a folder." />
        )
      }
      /*
        The conversation goes in the thread pane, which is where a conversation
        lives everywhere else in Peek — the same pane a topic's thread opens in.
        That is the point being demonstrated rather than a layout convenience: a
        Ship project's discussion is not a special panel bolted to a folder
        view, it is Peek's ordinary conversation surface pointed at a file
        another app owns.
      */
      threadPanel={
        openFile ? (
          <div className="flex h-full flex-col">
            {/*
              `ContainerHeader` takes no close, and Peek's thread pane does not
              use it — `ThreadPanel` heads itself and puts the close on the
              right. Same shape here so the two panes behave alike.
            */}
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-2-strong text-text-primary">
                  {openFile.slots.title?.value ?? 'Conversation'}
                </p>
                {/*
                  Whose file this is, said plainly. The panel draws another app's
                  conversation in Peek's own language, which is the point and is
                  also exactly what could mislead: without this the discussion
                  reads as something in Peek.
                */}
                {openFile.appName && (
                  <p className="truncate text-caption text-text-muted">In {openFile.appName}</p>
                )}
              </div>
              <IconButton
                tooltip="Close"
                aria-label="Close conversation"
                onClick={() => setOpenFile(null)}
              >
                <IconX size={16} stroke={1.5} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ForeignConversationView state={conversation} people={people} />
            </div>
          </div>
        ) : undefined
      }
    />
  )
}

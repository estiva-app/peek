import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { FolderContentsView } from '@/components/views/FolderContentsView'
import { useFolderContents, useFolders, useForeignObjects } from '@/api'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/TextInput'
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

  const selected = folders?.find((folder) => folder.id === id)

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
          {/* The list column of a two-column page, so its empties are sections
              (D51): the line alone, left, no icon. Loading is a skeleton, not a
              sentence (§4.7). */}
          {signedOut ? (
            <EmptyState scope="section" className="px-3 py-1" message="Sign in to see folders." />
          ) : folders === null ? (
            <SkeletonSidebarList />
          ) : folders.length === 0 ? (
            <EmptyState scope="section" className="px-3 py-1" message="No folders yet." />
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
              <FolderContentsView state={state} />
            </div>
          </div>
        ) : (
          <EmptyState message="Select a folder." />
        )
      }
    />
  )
}

import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { FolderContentsView } from '@/components/views/FolderContentsView'
import { useFolderContents, useFolders } from '@/api'

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
  const folders = useFolders()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { state } = useFolderContents(id)

  const selected = folders.find((folder) => folder.id === id)

  return (
    <AppShell
      leftPanel={
        <div className="flex h-full flex-col">
          <ContainerHeader title="Folders" />
          {folders.length === 0 ? (
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

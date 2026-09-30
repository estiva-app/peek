import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ForeignObject } from '@estiva-app/interop'
import { SHIP_PROJECT } from '@/api/fixtures'
import { MoveDialog } from './MoveDialog'

const topic = (d: string, title: string, extra: Partial<ForeignObject> = {}) =>
  ({
    ...SHIP_PROJECT,
    ref: `30840:${'a'.repeat(64)}:${d}`,
    address: `30840:${'a'.repeat(64)}:${d}`,
    kind: 30840,
    appName: 'File',
    parentField: 'parent',
    slots: { title: { value: title } },
    ...extra,
  }) as unknown as ForeignObject

const NOTES = topic('notes', 'Notes')
const BRIEF = topic('brief', 'Brief')
const HQ = { id: 'hq', name: 'Estiva HQ' }
const STEER = { id: 'steer', name: 'Steer' }

const optionsOf = async (name: string) => {
  await userEvent.click(screen.getByRole('combobox', { name }))
  // The package's Select marks the chosen option with a check; the label is the rest.
  return screen.getAllByRole('option').map((option) => option.textContent?.replace('✔️', ''))
}

describe('MoveDialog (FOL-45)', () => {
  it('opens on the Folder the file is in, with only real moves there', async () => {
    render(
      <MoveDialog
        file={NOTES}
        from="hq"
        folders={[HQ, STEER]}
        nests
        targets={[{ file: BRIEF, path: ['Brief'] }]}
        targetsIn={vi.fn()}
        onMove={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(await optionsOf('Put it under')).toEqual(['Brief'])
  })

  it('reads another Folder when it is picked, and moves to its top by default', async () => {
    const targetsIn = vi.fn(async () => [{ path: [] }, { file: BRIEF, path: ['Brief'] }])
    const onMove = vi.fn(async () => true)
    render(
      <MoveDialog file={NOTES} from="hq" folders={[HQ, STEER]} nests targets={[]} targetsIn={targetsIn} onMove={onMove} onClose={vi.fn()} />,
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Folder' }))
    await userEvent.click(screen.getByRole('option', { name: 'Steer' }))
    expect(targetsIn).toHaveBeenCalledWith('steer')
    expect(await optionsOf('Put it under')).toEqual(['The top of Steer', 'Brief'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith({ folder: 'steer', parent: '' }))
  })

  it('asks a file that nests under nothing only for the Folder, never offers the one it is in, and waits for a pick', async () => {
    const onMove = vi.fn(async () => true)
    render(<MoveDialog file={SHIP_PROJECT} from="hq" folders={[HQ, STEER]} nests={false} targetsIn={vi.fn()} onMove={onMove} onClose={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: 'Put it under' })).toBeNull()
    // Nothing preselected: a Move pressed straight away would be a move nobody chose.
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(await optionsOf('Folder')).toEqual(['Steer'])
    await userEvent.click(screen.getByRole('option', { name: 'Steer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith({ folder: 'steer' }))
  })

  it('never picks a project for an issue: Move waits until the person does', async () => {
    const issue = topic('issue', 'An issue', { kind: 30851, parentKind: 30850 } as Partial<ForeignObject>)
    const onMove = vi.fn(async () => true)
    const live = { file: topic('live', 'A live project', { kind: 30850 } as Partial<ForeignObject>), path: ['A live project'] }
    render(<MoveDialog file={issue} from="hq" folders={[HQ, STEER]} nests targets={[]} targetsIn={async () => [live]} onMove={onMove} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Folder' }))
    await userEvent.click(screen.getByRole('option', { name: 'Steer' }))
    await screen.findByRole('combobox', { name: 'Put it under' })
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox', { name: 'Put it under' }))
    await userEvent.click(screen.getByRole('option', { name: 'A live project' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith({ folder: 'steer', parent: live.file.address }))
  })

  it('says so when the picked Folder has nowhere to put it, and does not move', async () => {
    const issue = topic('issue', 'An issue', { kind: 30851, parentKind: 30850 } as Partial<ForeignObject>)
    render(<MoveDialog file={issue} from="hq" folders={[HQ, STEER]} nests targets={[]} targetsIn={async () => []} onMove={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Folder' }))
    await userEvent.click(screen.getByRole('option', { name: 'Steer' }))
    expect(await screen.findByText('There is nowhere in Steer to put it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('says a Folder that could not be read, and reads it again on Try again', async () => {
    const targetsIn = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([{ path: [] }])
    render(<MoveDialog file={NOTES} from="hq" folders={[HQ, STEER]} nests targets={[]} targetsIn={targetsIn} onMove={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Folder' }))
    await userEvent.click(screen.getByRole('option', { name: 'Steer' }))
    expect(await screen.findByText('Steer could not be read.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await optionsOf('Put it under')).toEqual(['The top of Steer'])
  })
})

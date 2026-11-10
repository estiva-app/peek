import { describe, expect, it } from 'vitest'
import { legacyTopicDestination, legacyTopicFile } from './legacyTopicLinks'
import { filePath } from './objectUrl'

const WIDGETS_FILE = '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:7a384136-31a6-4d91-80ac-1d599464d2f2'

describe('legacyTopicFile (SID-3)', () => {
  it('finds a topic’s file by its Convex id and by its channel', () => {
    expect(legacyTopicFile('t_1788532283888_1')).toEqual({ address: WIDGETS_FILE, title: 'Widgets' })
    expect(legacyTopicFile('widgets-aae9a8fa-b85e-44a3-8683-cb236f90ea74')).toEqual({ address: WIDGETS_FILE, title: 'Widgets' })
  })

  it('answers null for anything that was never a production topic, or a team’s channel', () => {
    expect(legacyTopicFile('t_never')).toBeNull()
    expect(legacyTopicFile('fd03975a-eb00-49d6-a4b7-33ead1854672')).toBeNull()
  })
})

describe('legacyTopicDestination', () => {
  it('lands a topic on its file, a team’s channel on its Folder, and nothing on null', () => {
    expect(legacyTopicDestination('t_1788532283888_1')).toBe(filePath(WIDGETS_FILE, 'Widgets'))
    expect(legacyTopicDestination('x-FD03975A-EB00-49D6-A4B7-33EAD1854672')).toBe('/app/folders/fd03975a-eb00-49d6-a4b7-33ead1854672')
    expect(legacyTopicDestination('t_never')).toBeNull()
  })
})

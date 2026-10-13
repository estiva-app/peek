// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DESK_PICTURE_KEY, clearDeskPicture, revealLiveDesk, revealWhenDeskDrawn, saveDeskPicture } from './deskPicture'
import { OWNER_KEY, SIGNED_OUT, clearDeviceCopy, resetDeviceCopyForTest } from '@/nostr/deviceCopy'
import { memorySnapshotStorage } from '@estiva-app/platform'

const saved = () => JSON.parse(localStorage.getItem(DESK_PICTURE_KEY) ?? 'null')

function drawDesk(main: string) {
  document.head.innerHTML = '<link rel="stylesheet" href="/assets/index-abc.css">'
  document.body.innerHTML = `<div id="root"><main id="desk-main">${main}</main></div>`
}

describe('the saved Desk', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/app/desk')
    localStorage.setItem(OWNER_KEY, 'relay|pubkey')
  })
  afterEach(() => resetDeviceCopyForTest())

  it('keeps a drawn plain Desk under the copy’s owner and stylesheet, without element ids or blob pictures', () => {
    drawDesk('<span id="x">Switch probe A</span><img src="blob:https://peek.estiva.app/1">')
    saveDeskPicture()
    expect(saved()).toEqual({ owner: 'relay|pubkey', css: '/assets/index-abc.css', html: '<main><span>Switch probe A</span><img></main>' })
  })

  it('keeps a title that reads like an attribute as text, with the next element intact', () => {
    drawDesk('<span>Bob id="</span><img class="avatar" alt="&lt;img src=x onerror=alert(1)&gt;">')
    saveDeskPicture()
    const parsed = document.createElement('div')
    parsed.innerHTML = saved().html
    expect(parsed.querySelector('span')?.textContent).toBe('Bob id="')
    expect(parsed.querySelector('img.avatar')?.getAttribute('alt')).toBe('<img src=x onerror=alert(1)>')
    expect(parsed.querySelectorAll('img')).toHaveLength(1)
  })

  it('keeps nothing while Desk is still loading, has something open, or nobody owns the copy', () => {
    drawDesk('<div class="animate-pulse"></div>')
    saveDeskPicture()
    expect(saved()).toBeNull()

    drawDesk('Switch probe A')
    history.replaceState(null, '', '/app/desk?open=30840:x:y')
    saveDeskPicture()
    expect(saved()).toBeNull()

    history.replaceState(null, '', '/app/desk')
    localStorage.setItem(OWNER_KEY, SIGNED_OUT)
    saveDeskPicture()
    expect(saved()).toBeNull()
  })

  it('goes with the copy on sign-out', async () => {
    resetDeviceCopyForTest(memorySnapshotStorage())
    drawDesk('Switch probe A')
    saveDeskPicture()
    expect(saved()).not.toBeNull()
    await clearDeviceCopy()
    expect(localStorage.getItem(DESK_PICTURE_KEY)).toBeNull()
  })

  it('gives way to a live Desk that keeps changing 100 ms after it has drawn, and never while it shows a skeleton', async () => {
    drawDesk('<div class="animate-pulse"></div>')
    const cover = document.createElement('div')
    cover.id = 'peek-picture'
    cover.innerHTML = '<main>Saved rows</main>'
    document.body.prepend(cover)
    window.__peekPicture = { shownAt: 10 }
    revealWhenDeskDrawn()
    const main = document.getElementById('desk-main')!
    const churn = setInterval(() => (main.dataset.tick = String(Date.now())), 20)
    const live = setInterval(() => main.append(document.createTextNode('.')), 30)
    await new Promise((r) => setTimeout(r, 250))
    expect(document.getElementById('peek-picture')).not.toBeNull()
    main.innerHTML = 'Live rows'
    await new Promise((r) => setTimeout(r, 400))
    clearInterval(churn)
    clearInterval(live)
    expect(document.getElementById('peek-picture')).toBeNull()
  })

  it('is removed from the page when the live Desk takes over', () => {
    drawDesk('Switch probe A')
    const cover = document.createElement('div')
    cover.id = 'peek-picture'
    document.body.prepend(cover)
    window.__peekPicture = { shownAt: 10 }
    revealLiveDesk()
    expect(document.getElementById('peek-picture')).toBeNull()
    expect(window.__peekPicture.liveAt).toBeTypeOf('number')
    clearDeskPicture()
  })
})

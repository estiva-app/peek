import { describe, it, expect } from 'vitest'
import {
  acceptsFileType,
  fileExtension,
  isImageAttachment,
  formatBytes,
  fileTypeLabel,
  pastedImageName,
  pastedImages,
  type ClipboardSource,
} from './fileAttachments'

/** Minimal File stand-in — jsdom's File works, but this keeps the size exact. */
function fakeFile(name: string, size = 1024, type = ''): File {
  return { name, size, type } as File
}

describe('fileAttachments', () => {
  it('extracts the lowercased extension', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
    expect(fileExtension('README')).toBe('')
  })

  it('accepts the allowlisted types incl. md/json/zip', () => {
    for (const n of ['a.png', 'b.pdf', 'c.md', 'd.json', 'e.zip', 'f.docx', 'g.csv']) {
      expect(acceptsFileType(fakeFile(n))).toBe(true)
    }
  })

  it('rejects executables even though they are not on the allowlist path', () => {
    expect(acceptsFileType(fakeFile('virus.exe'))).toBe(false)
    expect(acceptsFileType(fakeFile('script.sh'))).toBe(false)
  })

  it('rejects unsupported types', () => {
    expect(acceptsFileType(fakeFile('movie.mkv'))).toBe(false)
  })

  it('leaves size to the server’s limits, which the box checks: a 60 MB zip is not Peek’s to refuse', () => {
    expect(acceptsFileType(fakeFile('big.zip', 60 * 1024 * 1024))).toBe(true)
  })

  it('detects images by extension or content type', () => {
    expect(isImageAttachment('photo.jpg')).toBe(true)
    expect(isImageAttachment('x', 'image/png')).toBe(true)
    expect(isImageAttachment('doc.pdf')).toBe(false)
  })

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 bytes')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('labels the chip by type', () => {
    expect(fileTypeLabel('a.pdf')).toBe('PDF')
    expect(fileTypeLabel('README')).toBe('FILE')
  })
})

describe('pasted images', () => {
  const AT = new Date(2026, 8, 7, 14, 32, 5) // 2026-09-07 14:32:05, local

  /** A clipboard as the paste handler sees it. */
  function clipboard(text: string, files: File[] = []): ClipboardSource {
    return { files, getData: (format) => (format === 'text/plain' ? text : '') }
  }

  const png = (name = 'image.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type })

  it('names a screenshot after the moment it was pasted', () => {
    expect(pastedImageName('image/png', AT)).toBe('Screenshot 2026-09-07 14-32-05.png')
    expect(pastedImageName('image/jpeg', AT)).toBe('Screenshot 2026-09-07 14-32-05.jpg')
    expect(pastedImageName('image/png', AT, 1)).toBe('Screenshot 2026-09-07 14-32-05 (2).png')
  })

  it('gives an unsupported image its own extension, so it refuses itself', () => {
    const name = pastedImageName('image/tiff', AT)
    expect(name).toBe('Screenshot 2026-09-07 14-32-05.tiff')
    expect(acceptsFileType(fakeFile(name))).toBe(false)
  })

  it('attaches a screenshot, renamed', () => {
    const [file] = pastedImages(clipboard('', [png()]), AT)
    expect(file.name).toBe('Screenshot 2026-09-07 14-32-05.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(3)
    expect(acceptsFileType(file)).toBe(true)
  })

  /*
    The one that matters: a copy from Excel or Word carries a rendered picture
    of the selection next to the text. Attaching that instead of pasting the
    text would be wrong every time.
  */
  it('leaves the clipboard alone when it carries text', () => {
    expect(pastedImages(clipboard('Q3 revenue\t120', [png()]), AT)).toEqual([])
    expect(pastedImages(clipboard('   ', [png()]), AT)).toHaveLength(1)
  })

  it('keeps a real filename', () => {
    const [file] = pastedImages(clipboard('', [png('quarterly-chart.png')]), AT)
    expect(file.name).toBe('quarterly-chart.png')
  })

  it('names several images in one paste apart', () => {
    const files = pastedImages(clipboard('', [png(), png(), png('kept.png')]), AT)
    expect(files.map((f) => f.name)).toEqual([
      'Screenshot 2026-09-07 14-32-05.png',
      'Screenshot 2026-09-07 14-32-05 (2).png',
      'kept.png',
    ])
  })

  it('ignores everything that is not an image, and an empty clipboard', () => {
    const pdf = new File([new Uint8Array([1])], 'report.pdf', { type: 'application/pdf' })
    expect(pastedImages(clipboard('', [pdf]), AT)).toEqual([])
    expect(pastedImages(clipboard(''), AT)).toEqual([])
    expect(pastedImages(null, AT)).toEqual([])
  })
})

export type FileCategory = 'topic' | 'app' | 'document'

export interface DocumentFile {
  id: string
  category: 'document'
  docType: 'pdf' | 'image' | 'spreadsheet' | 'presentation' | 'generic'
  title: string
  subtitle?: string
}

/**
 * A file you can reference from a message.
 *
 * There was a second kind — an "app" file, which was only ever Figma: five
 * static documents and the frames inside them, mocking an integration nobody
 * has built. It went on 2026-09-11 with the rest of the Figma mock, and with it
 * went `APP_CATEGORIES` and `APP_FILES`, which had no other members.
 */
export type FileItem = DocumentFile

export const DOCUMENT_FILES: DocumentFile[] = [
  { id: 'doc-1', category: 'document', docType: 'pdf', title: 'Brand guidelines 2026.pdf', subtitle: '2.4 MB' },
  { id: 'doc-2', category: 'document', docType: 'image', title: 'Screenshot 2026-03-28.png', subtitle: '840 KB' },
  { id: 'doc-3', category: 'document', docType: 'spreadsheet', title: 'Q1 metrics export.xlsx', subtitle: '1.1 MB' },
  { id: 'doc-4', category: 'document', docType: 'presentation', title: 'Board deck Q1 2026.pptx', subtitle: '8.3 MB' },
  { id: 'doc-5', category: 'document', docType: 'generic', title: 'Meeting notes - March standup.txt', subtitle: '12 KB' },
]

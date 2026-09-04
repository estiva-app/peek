import { FIGMA_FRAMES } from './figmaData'

export type FileCategory = 'topic' | 'app' | 'document'

export interface AppFile {
  id: string
  category: 'app'
  app: 'figma'
  appLabel: string
  title: string
  subtitle?: string
}

export interface DocumentFile {
  id: string
  category: 'document'
  docType: 'pdf' | 'image' | 'spreadsheet' | 'presentation' | 'generic'
  title: string
  subtitle?: string
}

export type FileItem = AppFile | DocumentFile

export interface AppCategory {
  app: AppFile['app']
  label: string
  description: string
}

export const APP_CATEGORIES: AppCategory[] = [
  { app: 'figma', label: 'Figma', description: 'Files & frames' },
]

export const APP_FILES: AppFile[] = [
  // Figma
  { id: 'fg-1', category: 'app', app: 'figma', appLabel: 'Figma', title: 'Compose box redesign', subtitle: 'Peek App v2 · Components' },
  { id: 'fg-2', category: 'app', app: 'figma', appLabel: 'Figma', title: 'Onboarding flow screens', subtitle: 'Peek Mobile · Flows' },
  { id: 'fg-3', category: 'app', app: 'figma', appLabel: 'Figma', title: 'Navigation rail v3', subtitle: 'Peek App v2 · Components' },
  { id: 'fg-4', category: 'app', app: 'figma', appLabel: 'Figma', title: 'Settings page wireframes', subtitle: 'Peek App v2 · Pages' },
  { id: 'fg-5', category: 'app', app: 'figma', appLabel: 'Figma', title: 'Brand illustration set', subtitle: 'Peek Brand · Assets' },
  // Figma frames (from figmaData.ts) - being in APP_FILES makes their [titles]
  // re-parse into chips after a message is sent and lists them in the [ menu.
  ...FIGMA_FRAMES.map<AppFile>((f) => ({
    id: f.id,
    category: 'app',
    app: 'figma',
    appLabel: 'Figma',
    title: f.name,
    subtitle: `Frame · ${f.file} › ${f.page}`,
  })),
]

export const DOCUMENT_FILES: DocumentFile[] = [
  { id: 'doc-1', category: 'document', docType: 'pdf', title: 'Brand guidelines 2026.pdf', subtitle: '2.4 MB' },
  { id: 'doc-2', category: 'document', docType: 'image', title: 'Screenshot 2026-03-28.png', subtitle: '840 KB' },
  { id: 'doc-3', category: 'document', docType: 'spreadsheet', title: 'Q1 metrics export.xlsx', subtitle: '1.1 MB' },
  { id: 'doc-4', category: 'document', docType: 'presentation', title: 'Board deck Q1 2026.pptx', subtitle: '8.3 MB' },
  { id: 'doc-5', category: 'document', docType: 'generic', title: 'Meeting notes - March standup.txt', subtitle: '12 KB' },
]

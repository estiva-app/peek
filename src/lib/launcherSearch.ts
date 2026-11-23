// Moved to @estiva-app/launcher, which every app's ⌘K runs on (KIN-4). The path stays so Peek's callers do not change.
export {
  type RelayFailureKind,
  snippetAround,
  launcherMatch,
  isPrompt,
  matchPeople,
  type MessageSearchState,
  messageEmptyState,
  fileEmptyState,
} from '@estiva-app/launcher'

// Moved to @estiva-app/launcher, which every app's ⌘K runs on (KIN-4). The path stays so Peek's callers do not change.
import { launcherApps, type LauncherApp } from '@estiva-app/launcher'

export type { FormControl, FormField, LauncherAction, LauncherApp, VocabOption } from '@estiva-app/launcher'

/** Every app the launcher knows, as Peek's ⌘K sees them: Peek is the one it runs in. */
export const LAUNCHER_APPS: LauncherApp[] = launcherApps('peek')

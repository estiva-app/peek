import { isApplePlatform } from '@estiva-app/ui'

/** Ctrl+O, Cmd+O on a Mac: Add to Open work, again to take it out (Miky, 6 Nov). */
export const openWorkKey = () => (isApplePlatform() ? 'Cmd+O' : 'Ctrl+O')

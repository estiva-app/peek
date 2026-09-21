import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'

// The Storybook shell (sidebar, toolbar) matches the app's default dark theme.
// Estiva ID's heading starts closed: this Storybook is opened to look at Peek,
// and the other app's stories are there to compare against, not to scroll past
// (Katerina, 20 September).
addons.setConfig({ theme: themes.dark, sidebar: { collapsedRoots: ['estiva-id'] } })

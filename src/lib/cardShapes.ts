import { cardShapeMemory } from '@estiva-app/ui'

/**
 * The shape each chosen card took the last time this device drew it, so its
 * placeholder is the card's own height and the conversation does not move as
 * it loads: the kit's memory (`cardShapeMemory`, the one Ship and Leaf keep),
 * under Peek's own key. Kept like the not-available memory beside it
 * (`unavailableCards`), and cleared with the rest of the device's copy
 * (`deviceCopy`).
 *
 * Before a card was drawn here, an issue's is a title and its pickers: the
 * kit's own placeholder has room for a key line, which Peek's issue card does
 * not draw, and for a summary, which most issues do not have, so it closed by
 * 46 px as it drew (16 Oct).
 */
export const cardShapes = cardShapeMemory('peek.card-shapes', {
  firstDraw: { issue: { subtitle: false, summary: false, footer: 'pickers' } },
})

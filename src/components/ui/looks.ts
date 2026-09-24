/**
 * Looks Peek's own parts share, written once (UIG-25). A look typed again by
 * hand draws the same today and drifts the day one copy changes. A constant of
 * classes ends in `_CLASSES`, so the copied-look lint reads it as one.
 */

/**
 * The box you write in: the composer, and the edit box of a message and of a
 * reply (the edit box is a compose box, 8 September), and the huddle creator's
 * picture of one. The focus ring shows in Signal.
 */
export const WRITING_BOX_CLASSES =
  // @estiva-escape: (Katerina, 24 September: record only): Peek's writing box, close to the package's ChipInput box; Peek's own writing surface, kept as it is
  'relative bg-bg-inset border border-border-default rounded-lg p-3 flex flex-col gap-4 signal:transition-shadow signal:focus-within:border-border-focus signal:focus-within:shadow-focus-ring'

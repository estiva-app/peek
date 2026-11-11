import { useMemo } from 'react'
import { useAvatarSrc, useMentionNames, useRowNewsDetails, type RowNewsItem } from '@/api'

/**
 * What a list of lines needs to draw them (`NewsLine`): each line's words, its file's title, and each person's name and
 * face. A row's card draws five (`drawn` left out); a page's list (ACT-4) draws all of its own.
 */
export function useNewsLineDetails(items: readonly RowNewsItem[], drawn?: number) {
  const { wordsOf, titleOf } = useRowNewsDetails(items, drawn)
  const names = useMentionNames()
  const avatarSrcFor = useAvatarSrc()
  const nameOf = useMemo(() => new Map((names ?? []).map((n) => [n.pubkey, n] as const)), [names])
  return { wordsOf, titleOf, nameOf, avatarSrcFor }
}

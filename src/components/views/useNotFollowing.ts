import { useCallback } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { teamFactsOf, useMembership, useTopicFollowing, type Team } from '@/api'

/**
 * Whether you picked Not following on one of a team's places, a topic or an initiative: the one level a row shows
 * (Q-22), in the Teams column and on the team's page alike (Katerina, 17 November: "everywhere it appears"). A mute is
 * Not following too, as the bell shows it. Read from the same membership and teams reads the bell refreshes when a
 * level is picked, so a row says it as soon as the bell does.
 */
export function useNotFollowing(): (team: Team, topic: ForeignObject) => boolean {
  const followingOf = useTopicFollowing()
  const membership = useMembership()
  return useCallback(
    (team: Team, topic: ForeignObject) => {
      if (!topic.address) return false
      if (membership.termsOf(topic.address).muted) return true
      const following = followingOf(topic, teamFactsOf(team))
      return following !== undefined && !(following.in && following.level)
    },
    [followingOf, membership],
  )
}

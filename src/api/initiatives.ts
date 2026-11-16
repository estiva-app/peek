import type { ForeignObject } from '@estiva-app/interop'
import { spaceTeamOf, type Team } from './useTeams'
import type { TopicsColumnState } from './useTopicsColumn'

/**
 * **Initiatives**: today's topics that no team marks as one of its spaces (Katerina, 16 November, Q-01 A: an initiative
 * is today's topic with a new name; a team's topic `#` is today's space). The data stays as it is: the relay's space
 * mark is what tells the two apart, so a space never shows in Initiatives or on Explore initiatives; it is under its
 * team in Teams.
 *
 * Loading until the teams are read, so a space is never drawn and then taken away. Teams that could not be read cannot
 * say which are spaces: then every topic shows, as today.
 */
export function initiativesOf(topics: TopicsColumnState, teams: readonly Team[] | null, teamsFailed: boolean): TopicsColumnState {
  if (typeof topics !== 'object' || 'failed' in topics) return topics
  if (!teams) return teamsFailed ? topics : 'loading'
  const initiative = (topic: ForeignObject) => !spaceTeamOf(teams, topic.address ?? undefined)
  return { mine: topics.mine.filter(initiative), others: topics.others.filter(initiative), archived: topics.archived.filter(initiative) }
}

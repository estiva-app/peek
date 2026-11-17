import { topicSettled } from './pendingTopics'
import { readTopicsAgain } from './useTopicsColumn'
import { reloadTeamsOnScreen } from './useTeams'

/**
 * A topic just started shows in the lists beside its page as soon as it is written (Katerina, 15 and 17 November,
 * T-12: "it should be shown in the sidebar and be selected … It appears on page reload"). Its page opens at once and
 * its writes run behind it (PEE-6); once they land, the teams read again (the team's list now names it, with its mark)
 * and so do the topics the viewer can read (its object), which the Teams and Initiatives columns draw it from. Its row
 * is then the open page's, marked, and the column brings it into sight. A refused topic is not read for: it was taken
 * back.
 */
export function showStartedTopicWhenWritten(address: string): void {
  const readAgain = () => {
    readTopicsAgain()
    void reloadTeamsOnScreen()
  }
  const settled = topicSettled(address)
  // Not drawn ahead (its manifest could not be read): it was written before its page opened.
  if (!settled) return readAgain()
  void settled.then((outcome) => {
    if (outcome.ok) readAgain()
  })
}

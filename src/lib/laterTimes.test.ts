/**
 * The Screener's Later choices land on real times (Katerina, 30 October):
 * "Tomorrow" was 24 hours from the click, so a Later pressed at 11 PM came
 * back at 11 PM. Local time throughout, as the menu shows it.
 */
import { describe, expect, it } from 'vitest'
import { laterMenuTime, laterOptions } from './laterTimes'

/** Friday 30 October 2026, 11:05 PM local. */
const FRIDAY_LATE = new Date(2026, 9, 30, 23, 5).getTime()
/** Monday 2 November 2026, 10:00 AM local. */
const MONDAY_MORNING = new Date(2026, 10, 2, 10, 0).getTime()

const until = (now: number, label: string) => laterOptions(now).find((o) => o.label === label)!.untilMs

describe('Later', () => {
  it('offers four choices, in this order', () => {
    expect(laterOptions(FRIDAY_LATE).map((o) => o.label)).toEqual(['In 1 hour', 'In 3 hours', 'Tomorrow', 'Next week'])
  })

  it('"Tomorrow" pressed late at night is tomorrow at 9:00 AM, not 24 hours on', () => {
    expect(new Date(until(FRIDAY_LATE, 'Tomorrow'))).toEqual(new Date(2026, 9, 31, 9, 0))
  })

  it('"Next week" is the coming Monday at 9:00 AM', () => {
    expect(new Date(until(FRIDAY_LATE, 'Next week'))).toEqual(new Date(2026, 10, 2, 9, 0))
  })

  it('"Next week" pressed on a Monday is the Monday a week on', () => {
    expect(new Date(until(MONDAY_MORNING, 'Next week'))).toEqual(new Date(2026, 10, 9, 9, 0))
  })

  it('the hours are hours from the click', () => {
    expect(until(MONDAY_MORNING, 'In 1 hour') - MONDAY_MORNING).toBe(60 * 60 * 1000)
    expect(until(MONDAY_MORNING, 'In 3 hours') - MONDAY_MORNING).toBe(3 * 60 * 60 * 1000)
  })

  it('each row says when it lands: a bare time today, the day’s name before it on another day', () => {
    const shown = (now: number) => laterOptions(now).map((o) => laterMenuTime(o.untilMs, now))
    expect(shown(MONDAY_MORNING)).toEqual(['11:00 AM', '1:00 PM', 'Tue 9:00 AM', 'Mon 9:00 AM'])
    // An hour after 11:05 PM is past midnight: Saturday's, so it names Saturday.
    expect(shown(FRIDAY_LATE)).toEqual(['Sat 12:05 AM', 'Sat 2:05 AM', 'Sat 9:00 AM', 'Mon 9:00 AM'])
  })
})

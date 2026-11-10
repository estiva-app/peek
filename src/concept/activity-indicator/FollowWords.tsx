import { useState } from 'react'
import { IconCheck } from '@tabler/icons-react'
import { IconButton, LevelIcon, Menu, MenuItem, MenuSection, type FollowLevel } from '@estiva-app/ui'
import { NEW_WORDS, TODAY_WORDS } from './rules'

/**
 * The follow switch with its new words: what the place shows at each level,
 * and what lights its dot. The kit's FollowSwitch, copied only to change the
 * three lines under the levels (estiva-ui `src/FollowSwitch.tsx` WORDS and
 * `offDescription`); the dot's card now says what lit it.
 */
export function FollowWords({ level: start, place = 'topic', today = false, open = true }: { level: FollowLevel | undefined; place?: 'topic' | 'chat'; today?: boolean; open?: boolean }) {
  const [level, setLevel] = useState(start)
  const [isOpen, setOpen] = useState(open)
  const words = today ? TODAY_WORDS : NEW_WORDS[place]
  const people = place === 'chat'
  const now = level ? `You follow it at ${level === 'all' ? 'All' : 'Important'}` : 'Not following'
  const item = (choice: FollowLevel | undefined, label: string, description: string) => {
    const on = choice === level
    return (
      <MenuItem
        leading={<LevelIcon level={choice} people={people} />}
        label={label}
        description={description}
        selected={on}
        trailing={on ? <IconCheck size={16} stroke={1.5} aria-hidden /> : undefined}
        onClick={() => setLevel(choice)}
      />
    )
  }
  return (
    <Menu
      open={isOpen}
      onOpenChange={setOpen}
      trigger={
        <IconButton aria-label={`${now}: change how you follow it`} tooltip={now}>
          <LevelIcon level={level} people={people} />
        </IconButton>
      }
    >
      <MenuSection label="How you follow it">
        {item(undefined, 'Not following', words.off)}
        {item('important', 'Important', words.important)}
        {item('all', 'All', words.all)}
      </MenuSection>
    </Menu>
  )
}

import type { Scenario } from './player'
import { MeetCall } from './scenes/MeetCall'
import { MeetEnded } from './scenes/MeetEnded'

// Scene stubs — each gets replaced by its pixel-perfect build (see
// STORYBOARD.md for the beat map and status).

function Stub({ title, beat }: { title: string; beat: string }) {
  return (
    <div className="stub">
      <h1>{title}</h1>
      <p>{beat}</p>
    </div>
  )
}

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    title: 'Highlights in Huddle',
    scenes: [
      {
        id: 'meet-call',
        steps: 1,
        render: () => <MeetCall />,
      },
      {
        id: 'meet-ended',
        steps: 2,
        render: (local) => <MeetEnded showHighlights={local >= 1} />,
      },
      {
        id: 'peek-topic',
        steps: 2,
        render: (local) => (
          <Stub
            title="Peek — Payment integration"
            beat={
              local === 0
                ? 'Collapsed Highlights bar just arrived (real app iframe pending)'
                : 'Highlights card expanded'
            }
          />
        ),
      },
    ],
  },
]

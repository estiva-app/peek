import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd } from '@estiva-app/ui'
import {
  IconArrowUp,
  IconAt,
  IconBolt,
  IconChevronRight,
  IconCircleCheckFilled,
  IconMoodSmile,
  IconPaperclip,
  IconX,
} from '@tabler/icons-react'

/**
 * **Signal** — a Storybook-only theme preview built from the design-lab v3
 * palette. Pick `signal` in the theme toolbar to see every existing component
 * remapped; this page documents the tokens **and** the approved detail
 * specimens (reply row, kbd chips, composer hint, thread eyebrow, gradient
 * avatars, glow effects, hairline pane split). Nothing here ships to the app.
 */
const meta: Meta = {
  title: 'Docs/Signal Theme',
  parameters: {
    forceTheme: 'signal',
    layout: 'fullscreen',
  },
}
export default meta

type Story = StoryObj

/* ---------- shared bits ---------- */

const mono = 'var(--font-mono)'

const PEOPLE = [
  { name: 'Priya Shah', color: '#b18cff' },
  { name: 'Tom Okafor', color: '#ffc94d' },
  { name: 'Jonas Petrov', color: '#4ade8c' },
  { name: 'Maya Lindqvist', color: '#ff8f6b' },
  { name: 'Cath', color: '#56c8ff' },
  { name: 'Dana Kim', color: '#5fdfd6' },
]

function GradientAvatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: '32%',
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        color: '#08121c',
        fontWeight: 700,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(160deg, color-mix(in srgb, ${color} 92%, #fff) 0%, color-mix(in srgb, ${color} 70%, #0b0d11) 100%)`,
      }}
    >
      {initials}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <div className="sig-eyebrow" style={{ marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </section>
  )
}

function Swatch({ label, value, bg, border }: { label: string; value: string; bg: string; border?: boolean }) {
  return (
    <div style={{ width: 128 }}>
      <div
        style={{
          height: 52,
          borderRadius: 8,
          background: bg,
          border: border ? '1px solid var(--border-default)' : '1px solid transparent',
        }}
      />
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6 }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

/* ---------- the page ---------- */

export const Specimens: Story = {
  render: () => (
    <div style={{ padding: '40px 48px', maxWidth: 920, margin: '0 auto', position: 'relative' }}>
      <style>{`
        .sig-eyebrow {
          font-family: ${mono}; font-size: 10px; font-weight: 500;
          letter-spacing: .16em; text-transform: uppercase; color: var(--text-muted);
        }
        .sig-reply-row {
          display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px 4px 6px;
          border: 1px solid transparent; border-radius: 8px; background: none;
          font-size: 12px; font-weight: 600; color: var(--text-interactive); cursor: pointer;
          transition: border-color .12s, background .12s;
        }
        .sig-reply-row:hover { border-color: var(--accent-wash-2); background: var(--accent-wash); }
        .sig-reply-row .last { color: var(--text-muted); font-weight: 400; font-family: ${mono}; font-size: 9.5px; }
        .sig-reply-row .go { color: var(--text-disabled); display: inline-flex; transition: translate .12s, color .12s; }
        .sig-reply-row:hover .go { translate: 2px 0; color: var(--text-interactive); }
        .sig-pile { display: flex; }
        .sig-pile > * + * { margin-left: -5px; }
        .sig-pile > * { border: 1.5px solid var(--bg-surface); border-radius: 32%; }
        .sig-send {
          width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center;
          border: none; cursor: pointer; background: var(--accent-primary); color: var(--text-inverse);
          box-shadow: var(--glow-accent); transition: background .12s;
        }
        .sig-send:hover { background: var(--accent-hover); }
        .sig-ibtn {
          width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
          border: none; cursor: pointer; background: none; color: var(--text-muted);
          transition: background .12s, color .12s;
        }
        .sig-ibtn:hover { background: rgba(255,255,255,.06); color: var(--text-primary); }
        .sig-composer {
          border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-elevated);
          transition: border-color .16s, box-shadow .16s;
        }
        .sig-composer:focus-within { border-color: rgba(86,200,255,.55); box-shadow: var(--focus-ring); }
        .sig-composer textarea {
          display: block; width: 100%; border: none; background: none; resize: none;
          font: inherit; font-size: 14.5px; line-height: 1.55; padding: 11px 14px 2px;
          color: var(--text-primary); outline: none;
        }
        .sig-composer textarea::placeholder { color: var(--text-muted); }
      `}</style>

      <div className="sig-eyebrow">Signal · Storybook-only theme preview</div>
      <h1 style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em', margin: '10px 0 6px' }}>
        Tokens &amp; approved specimens
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: '60ch', marginBottom: 36 }}>
        Flip the toolbar between dark and signal to compare any component. New tokens introduced here: accent washes,
        glow shadows, <code style={{ fontFamily: mono, fontSize: 12 }}>--text-interactive</code> and{' '}
        <code style={{ fontFamily: mono, fontSize: 12 }}>--font-mono</code> for metadata.
      </p>

      <Section title="Surfaces">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Swatch label="bg-base" value="#0e1014" bg="var(--bg-base)" border />
          <Swatch label="bg-surface" value="#12151a" bg="var(--bg-surface)" border />
          <Swatch label="bg-elevated" value="#191d24" bg="var(--bg-elevated)" border />
          <Swatch label="bg-inset" value="#20242d" bg="var(--bg-inset)" border />
          <Swatch label="border-subtle" value="white @ 6.5%" bg="var(--border-subtle)" />
          <Swatch label="border-default" value="white @ 12%" bg="var(--border-default)" />
        </div>
      </Section>

      <Section title="The signal trio + washes">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Swatch label="accent-primary" value="#56c8ff · interactive" bg="var(--accent-primary)" />
          <Swatch label="text-interactive" value="#8ad6ff · links" bg="var(--text-interactive)" />
          <Swatch label="accent-wash / 2" value="cyan @ 11% / 22%" bg="var(--accent-wash-2)" />
          <Swatch label="warning-default" value="#ffb020 · needs you" bg="var(--warning-default)" />
          <Swatch label="warning-wash" value="amber @ 12%" bg="var(--warning-wash)" />
          <Swatch label="success-default" value="#3fde8c · resolved" bg="var(--success-default)" />
          <Swatch label="success-wash" value="green @ 11%" bg="var(--success-wash)" />
        </div>
      </Section>

      <Section title="Glow effects (semantic elevation)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
          <button className="sig-send" aria-label="Send">
            <IconArrowUp size={16} stroke={2.2} />
          </button>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--warning-default)',
              boxShadow: 'var(--glow-warning)',
            }}
            title="unread signal"
          />
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--success-default)',
              boxShadow: 'var(--glow-success)',
            }}
            title="online presence"
          />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 22,
              padding: '0 9px',
              borderRadius: 999,
              fontFamily: mono,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--success-default)',
              background: 'var(--success-wash)',
              border: '1px solid rgba(63,222,140,.3)',
              boxShadow: '0 0 14px -4px rgba(63,222,140,.5)',
            }}
          >
            <IconCircleCheckFilled size={12} /> Resolved
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontFamily: mono,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--warning-default)',
              background: 'var(--warning-wash)',
              border: '1px solid rgba(255,176,32,.3)',
              borderRadius: 999,
              padding: '2px 7px',
            }}
          >
            <IconBolt size={10} stroke={2.2} /> Urgent
          </span>
        </div>
      </Section>

      <Section title="Reply row — facepile, count, last reply, arrow, hover">
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>Maya Lindqvist</span>
            <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--text-disabled)' }}>Mon 11:15</span>
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, maxWidth: '52ch' }}>
            Direction I want to try: collapse setup into one screen, defer everything that can be deferred.
          </div>
          <button className="sig-reply-row">
            <span className="sig-pile">
              <GradientAvatar name="Priya Shah" color="#b18cff" size={17} />
              <GradientAvatar name="Jonas Petrov" color="#4ade8c" size={17} />
              <GradientAvatar name="Cath" color="#56c8ff" size={17} />
            </span>
            3 replies
            <span className="last">Mon 15:20</span>
            <span className="go">
              <IconChevronRight size={13} stroke={2} />
            </span>
          </button>
        </div>
      </Section>

      <Section title="Thread panel eyebrow">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 50,
            padding: '0 16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
          }}
        >
          <span className="sig-eyebrow" style={{ color: 'var(--text-interactive)', flex: 1 }}>
            Thread
          </span>
          <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--text-disabled)' }}>in Onboarding revamp</span>
          <button className="sig-ibtn" aria-label="Close">
            <IconX size={15} stroke={1.75} />
          </button>
        </div>
      </Section>

      <Section title="Composer — mono hint, glowing send, focus ring (click in)">
        <div className="sig-composer">
          <textarea rows={1} placeholder="Write to Onboarding revamp…" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '5px 7px 7px' }}>
            <button className="sig-ibtn" aria-label="Attach">
              <IconPaperclip size={15} stroke={1.75} />
            </button>
            <button className="sig-ibtn" aria-label="Mention">
              <IconAt size={15} stroke={1.75} />
            </button>
            <button className="sig-ibtn" aria-label="Emoji">
              <IconMoodSmile size={15} stroke={1.75} />
            </button>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: mono,
                fontSize: 9,
                color: 'var(--text-disabled)',
                marginRight: 9,
                letterSpacing: '.04em',
              }}
            >
              ENTER SEND · SHIFT+ENTER LINE
            </span>
            <button className="sig-send" aria-label="Send">
              <IconArrowUp size={16} stroke={2.2} />
            </button>
          </div>
        </div>
      </Section>

      <Section title="Commands & navigation tips (palette footer)">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '8px 14px',
            border: '1px solid var(--border-subtle)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,.02)',
            borderRadius: 10,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>Enter</Kbd> open
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>Esc</Kbd> close
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>A</Kbd> accept
            <Kbd>D</Kbd> decline
          </span>
        </div>
      </Section>

      <Section title="Avatar fallback — gradient initials (no photo needed)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {PEOPLE.map((p) => (
            <GradientAvatar key={p.name} name={p.name} color={p.color} size={34} />
          ))}
        </div>
      </Section>

      <Section title="Pane split (from v2) — hairline border + inset top highlight">
        <div style={{ background: 'var(--bg-base)', padding: 18, borderRadius: 12 }}>
          <div
            style={{
              height: 96,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 13,
              boxShadow: 'var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,.035)',
              display: 'grid',
              placeItems: 'center',
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            content pane · lifted off the dark canvas
          </div>
        </div>
      </Section>

      <Section title="Metadata in mono — timestamps">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 650 }}>Jonas Petrov</span>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--text-disabled)' }}>Mon 13:48</span>
          <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--text-muted)' }}>· 4 PEOPLE · SINCE MONDAY</span>
        </div>
      </Section>
    </div>
  ),
}

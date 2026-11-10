import { BrowserChrome } from './BrowserChrome'
import { googleSans } from './MeetCall'
import meetLogo from '../assets/meet/meet-logo.png'
import highlightsCam from '../assets/meet/highlights-cam.png'
import avatarBase from '../assets/meet/avatar-base.png'
import avatarOverlay from '../assets/meet/avatar-overlay.png'
import avatarAmie from '../assets/meet/avatar-amie.png'
import avatarGreg from '../assets/meet/avatar-greg.png'
import avatarJuan from '../assets/meet/avatar-juan.png'

// ── Signal-theme tokens (hardcoded — this mock is standalone) ──
// The doc card deliberately wears Peek's SIGNAL theme while sitting on
// Meet's white page: the highlights read as a Peek/Nostr object that
// landed in Meet, not as a Google feature. Values from src/index.css
// `.signal` + the Signal styling conventions (mono uppercase labels,
// mono tabular meta, cyan accent washes).
const S = {
  surface: '#12151a',
  elevated: '#191d24',
  inset: '#20242d',
  textPrimary: '#eef1f6',
  textSecondary: '#b2b9c6',
  textMuted: '#6b7280',
  borderDefault: 'rgba(255,255,255,0.12)',
  borderSubtle: 'rgba(255,255,255,0.065)',
  borderStrong: 'rgba(255,255,255,0.22)',
  accentMuted: 'rgba(86,200,255,0.11)',
  warning: '#ffb020',
  info: '#8ad6ff',
  success: '#3fde8c',
  shadow: '0 0 0 1px rgba(255,255,255,0.08), 0 12px 28px rgba(0,0,0,0.35), 0 36px 90px -16px rgba(0,0,0,0.45)',
} as const

const SWATCH = { insight: S.warning, question: S.info, conclusion: S.success } as const

const geist = { fontFamily: "'Geist', sans-serif" }
const geistMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" }

function Avatar16({ photo }: { photo?: string }) {
  return (
    <div className="flex items-center justify-center overflow-clip relative rounded-[4px] shrink-0 size-[16px]" style={{ backgroundColor: S.inset }}>
      <div className="relative size-full">
        <img alt="" className="absolute max-w-none object-cover size-full" src={avatarBase} />
        <img alt="" className="absolute max-w-none object-cover size-full" src={avatarOverlay} />
        {photo && <img alt="" className="absolute max-w-none object-cover size-full" src={photo} />}
      </div>
    </div>
  )
}

function PersonChip({ name, photo }: { name: string; photo?: string }) {
  return (
    <div className="flex gap-[4px] items-center relative shrink-0">
      <Avatar16 photo={photo} />
      <span className="text-[9px] leading-[12px] whitespace-nowrap" style={{ ...geist, color: S.textSecondary }}>
        {name}
      </span>
    </div>
  )
}

/** Signal HighlightPill: cyan wash + mono 10px semibold label. */
function Pill({ type, label }: { type: keyof typeof SWATCH; label: string }) {
  return (
    <div className="flex gap-[6px] items-center justify-center px-[6px] py-[2px] rounded-[4px] shrink-0" style={{ backgroundColor: S.accentMuted }}>
      <div className="rounded-[2px] shrink-0 size-[10px]" style={{ backgroundColor: SWATCH[type] }} />
      <p className="font-semibold leading-[1.1] text-[10px] tracking-[0.02em] whitespace-nowrap" style={{ ...geistMono, color: S.textPrimary }}>
        {label}
      </p>
    </div>
  )
}

/** Signal section label: mono 10px uppercase, text-primary (ruling 2026-07-23). */
function SignalSectionLabel({ children }: { children: string }) {
  return (
    <p className="font-medium text-[10px] uppercase tracking-[0.14em] leading-[normal] w-full" style={{ ...geistMono, color: S.textPrimary }}>
      {children}
    </p>
  )
}

function KeyPointGroup({ type, label, lines, width }: { type: keyof typeof SWATCH; label: string; lines: string[]; width?: number }) {
  return (
    <div className="flex flex-col gap-[10px] items-start relative shrink-0" style={{ width: width ?? '100%' }}>
      <Pill type={type} label={label} />
      <div className="flex flex-col gap-[8px] items-start text-[14px] w-full" style={{ ...geist, color: S.textSecondary }}>
        {lines.map((line, i) => (
          <ul key={i} className="w-full" style={{ listStyle: 'disc outside', paddingLeft: 21 }}>
            <li style={{ color: S.textMuted }}>
              <span className="leading-[1.3]" style={{ color: S.textSecondary }}>{line}</span>
            </li>
          </ul>
        ))}
      </div>
    </div>
  )
}

function ActionItem({ text, name, photo }: { text: string; name: string; photo?: string }) {
  return (
    <div className="flex gap-px items-center relative shrink-0 w-full">
      <div className="flex h-[36px] items-start shrink-0 w-[21px]">
        <div
          className="rounded-[4px] shrink-0 size-[16px]"
          style={{ backgroundColor: S.inset, border: `1px solid ${S.borderStrong}` }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-[4px] items-start justify-center min-w-px relative ml-[5px]">
        <p className="leading-[1.3] text-[14px] w-full" style={{ ...geist, color: S.textSecondary }}>{text}</p>
        <PersonChip name={name} photo={photo} />
      </div>
    </div>
  )
}

/** Scenario 1, scene 2 — "You left the meeting" + the Highlights doc
 *  (Figma 681:2417). `showHighlights` is beat 2: the doc card rises in. */
export function MeetEnded({ showHighlights }: { showHighlights: boolean }) {
  return (
    <div className="bg-white relative size-full">
      <BrowserChrome tabTitle="Meet - Kick off" urlHost="meet.google.com" urlPath="/uir-wmte-coi?authuser=2" />

      <div className="absolute bg-white h-[945px] left-0 overflow-clip top-[79px] w-[1440px]">
        {/* Meet logo + status line */}
        <div className="absolute h-[56px] left-[16px] top-[28px] w-[59px]">
          <img alt="" className="absolute inset-0 max-w-none object-cover size-full" src={meetLogo} />
        </div>
        <div className="-translate-y-1/2 absolute left-[80px] text-[#202124] text-[12px] top-[53.5px] whitespace-nowrap" style={googleSans}>
          <p className="leading-[normal]">Returning to home screen</p>
        </div>

        {/* Center block */}
        <div className="-translate-x-1/2 -translate-y-1/2 absolute left-1/2 text-[#0d0d0d] text-[36px] text-center top-[139.5px] whitespace-nowrap" style={googleSans}>
          <p className="leading-[normal]">You left the meeting</p>
        </div>
        <div className="absolute border border-[#747775] border-solid flex items-center justify-center left-[571px] px-[24px] py-[12px] rounded-[999px] top-[194px]">
          <span className="font-medium text-[#0b57d0] text-[14px] leading-[normal] whitespace-nowrap" style={googleSans}>Rejoin</span>
        </div>
        <div className="absolute bg-[#0b57d0] flex items-center justify-center left-[668px] px-[24px] py-[12px] rounded-[999px] top-[194px]">
          <span className="font-medium text-[14px] text-white leading-[normal] whitespace-nowrap" style={googleSans}>Return to home screen</span>
        </div>
        <div className="-translate-x-1/2 absolute flex items-center justify-center left-1/2 px-[24px] py-[12px] rounded-[999px] top-[252px]">
          <span className="font-medium text-[#0b57d0] text-[14px] leading-[normal] whitespace-nowrap" style={googleSans}>Submit feedback</span>
        </div>

        {/* Highlights doc — beat 2 rises in. Signal-themed: a Peek object
            visually distinct from Meet's own white UI. */}
        <div
          className="absolute h-[701px] left-[390px] overflow-clip rounded-[24px] top-[352px] w-[659px] transition-all duration-500 ease-out"
          style={{
            backgroundColor: S.surface,
            border: `1px solid ${S.borderDefault}`,
            boxShadow: S.shadow,
            opacity: showHighlights ? 1 : 0,
            transform: showHighlights ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          {/* Header — the app's own highlights icon in an inset chip */}
          <div className="absolute flex items-center justify-center overflow-clip rounded-full size-[40px] left-[23px] top-[23px]" style={{ backgroundColor: S.inset }}>
            <img alt="" width={20} height={20} className="size-[20px]" src={highlightsCam} />
          </div>
          <div className="-translate-y-1/2 absolute font-semibold left-[80px] text-[20px] top-[33.5px] whitespace-nowrap" style={{ ...geist, color: S.textPrimary }}>
            <p className="leading-[normal]">Highlights</p>
          </div>
          <div className="-translate-y-1/2 absolute left-[80px] text-[10px] tracking-[0.02em] top-[57.5px] whitespace-nowrap tabular-nums" style={{ ...geistMono, color: S.textMuted }}>
            <p className="leading-[normal]">Kick off · September 9, 2026 · 42 min</p>
          </div>
          <div className="absolute flex gap-[12px] items-center left-[80px] top-[77px]">
            <PersonChip name="Amie Miles" photo={avatarAmie} />
            <PersonChip name="Alice Curtis" />
            <PersonChip name="Greg Bothman" photo={avatarGreg} />
            <PersonChip name="Juan Foley" photo={avatarJuan} />
          </div>
          <div className="absolute h-px left-[23px] top-[109px] w-[611px]" style={{ backgroundColor: S.borderSubtle }} />

          {/* Key points */}
          <div className="absolute flex flex-col gap-[16px] items-start left-[23px] top-[126px] w-[611px]">
            <SignalSectionLabel>Key points</SignalSectionLabel>
            <div className="flex flex-col gap-[16px] items-start relative shrink-0 w-full">
              <KeyPointGroup
                type="insight"
                label="Insight"
                lines={[
                  'Went with Stripe Checkout for v1 instead of a custom card form.',
                  'Walked through the failure and 3DS-declined states and where customers get stuck.',
                ]}
              />
              <KeyPointGroup
                type="question"
                label="Question"
                width={592}
                lines={['What does Stripe return after a 3DS decline, and which codes do we show the customer?']}
              />
              <KeyPointGroup
                type="conclusion"
                label="Conclusion"
                width={437}
                lines={['Agreed reconciliation needs a fallback in case a webhook is late.']}
              />
            </div>
          </div>

          {/* Action items */}
          <div className="absolute left-[23px] top-[386px] w-[611px]">
            <SignalSectionLabel>Action items</SignalSectionLabel>
          </div>
          <div className="absolute flex flex-col gap-[8px] items-start left-[23px] top-[416px] w-[611px]">
            <ActionItem text="Draft the payment flow in Figma, including failure states" name="Alice Curtis" />
            <ActionItem text="Scope webhooks and the reconciliation job as the first PR" name="Greg Bothman" photo={avatarGreg} />
            <ActionItem text="Send Stripe test keys and the decline codes to handle" name="Juan Foley" photo={avatarJuan} />
          </div>
        </div>
      </div>
    </div>
  )
}

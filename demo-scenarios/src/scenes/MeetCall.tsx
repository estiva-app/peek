import { BrowserChrome } from './BrowserChrome'
import greg from '../assets/meet/greg.png'
import designer from '../assets/meet/designer.png'
import stripeEng from '../assets/meet/stripe-eng.png'
import aliceCircle from '../assets/meet/alice-circle.svg'
import micBadgeDesigner from '../assets/meet/mic-badge-designer.svg'
import micBadgeAlice from '../assets/meet/mic-badge-alice.svg'
import micOff from '../assets/meet/mic-off.svg'
import moreAudio from '../assets/meet/more-audio.svg'
import videocam from '../assets/meet/videocam.svg'
import moreVideo from '../assets/meet/more-video.svg'
import shareScreen from '../assets/meet/share-screen.svg'
import mood from '../assets/meet/mood.svg'
import closedCaption from '../assets/meet/closed-caption.svg'
import backHand from '../assets/meet/back-hand.svg'
import moreVert from '../assets/meet/more-vert.svg'
import callEnd from '../assets/meet/call-end.svg'
import chat from '../assets/meet/chat.svg'
import lockPerson from '../assets/meet/lock-person.svg'
import info from '../assets/meet/info.svg'

export const googleSans = {
  fontFamily: "'Google Sans Flex', 'Google Sans', 'Roboto', sans-serif",
}

// The dim radial vignette behind Alice's initial tile (Figma 681:2339 fill).
const aliceGradient = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 684 389' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(48.857 0 0 27.786 342 194.5)'><stop stop-color='rgba(44,55,99,1)' offset='0'/><stop stop-color='rgba(34,44,84,1)' offset='0.35'/><stop stop-color='rgba(26,35,71,1)' offset='0.65'/><stop stop-color='rgba(18,25,54,1)' offset='0.825'/><stop stop-color='rgba(10,15,36,1)' offset='1'/></radialGradient></defs></svg>\")",
}

function NameLabel({ name }: { name: string }) {
  return (
    <div
      className="-translate-y-1/2 absolute flex flex-col font-medium justify-center leading-[0] left-[16px] text-[16px] text-white top-[363px] whitespace-nowrap"
      style={googleSans}
    >
      <p className="leading-[normal]">{name}</p>
    </div>
  )
}

function MutedBadge({ src, bgOpacity }: { src: string; bgOpacity: number }) {
  return (
    <div
      className="absolute overflow-clip right-[16px] rounded-[100px] size-[26px] top-[16px]"
      style={{ backgroundColor: `rgba(255,255,255,${bgOpacity})` }}
    >
      <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[15.45px] left-[calc(50%-0.53px)] top-[calc(50%+0.23px)] w-[14.85px]">
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={src} />
      </div>
    </div>
  )
}

function RoundControl({ icon, width = 56, bg = '#333537' }: { icon: string; width?: number; bg?: string }) {
  return (
    <div className="h-[48px] overflow-clip relative rounded-[100px] shrink-0" style={{ width, backgroundColor: bg }}>
      <div className="-translate-x-1/2 -translate-y-1/2 absolute left-1/2 size-[24px] top-1/2">
        <img alt="" className="absolute block inset-0 max-w-none size-full" src={icon} />
      </div>
    </div>
  )
}

/** Scenario 1, scene 1 — the Google Meet in-call grid (Figma 666:658). */
export function MeetCall() {
  return (
    <div className="bg-white relative size-full">
      <BrowserChrome tabTitle="Meet - Kick off" urlHost="meet.google.com" urlPath="/uir-wmte-coi?authuser=2" />

      <div className="absolute bg-[#131314] h-[945px] left-0 overflow-clip top-[79px] w-[1440px]">
        {/* Clock row */}
        <div className="-translate-y-1/2 absolute flex flex-col font-medium justify-center leading-[0] left-[30px] text-[16px] text-white top-[41px] whitespace-nowrap" style={googleSans}>
          <p className="leading-[normal]">9:30 AM</p>
        </div>
        <div className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col font-normal justify-center leading-[0] left-[102.5px] text-[#9a9a9a] text-[16px] text-center top-[41px] whitespace-nowrap" style={googleSans}>
          <p className="leading-[normal]">|</p>
        </div>
        <div className="-translate-y-1/2 absolute flex flex-col font-medium justify-center leading-[0] left-[113px] text-[16px] text-white top-[41px] whitespace-nowrap" style={googleSans}>
          <p className="leading-[normal]">Kick off</p>
        </div>
        <div className="absolute left-[183px] size-[16px] top-[33px]">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={info} />
        </div>

        {/* 2×2 participant grid */}
        <div className="absolute gap-[12px] grid grid-cols-2 grid-rows-2 h-[790px] left-[30px] top-[69px] w-[1380px]">
          <div className="overflow-clip relative rounded-[24px]">
            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[24px]">
              <img alt="" className="absolute h-[175.84%] left-0 max-w-none top-[-10.69%] w-full" src={greg} />
            </div>
            <NameLabel name="Greg Bothman" />
          </div>
          <div className="overflow-clip relative rounded-[24px]">
            <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none rounded-[24px] size-full" src={designer} />
            <NameLabel name="Peek Designer" />
            <MutedBadge src={micBadgeDesigner} bgOpacity={0.33} />
          </div>
          <div className="overflow-clip relative rounded-[24px]" style={aliceGradient}>
            <NameLabel name="Alice Curtis" />
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-1/2 size-[88px] top-[calc(50%+0.5px)]">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={aliceCircle} />
            </div>
            <div className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col font-normal justify-center leading-[0] left-1/2 size-[88px] text-[48px] text-center text-white top-[calc(50%+0.5px)]" style={googleSans}>
              <p className="leading-[normal]">A</p>
            </div>
            <MutedBadge src={micBadgeAlice} bgOpacity={0.17} />
          </div>
          <div className="overflow-clip relative rounded-[24px]">
            <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none rounded-[24px] size-full" src={stripeEng} />
            <NameLabel name="Stripe Engineer" />
          </div>
        </div>

        {/* Center control bar */}
        <div className="absolute bg-[#1e1f20] flex gap-[8px] items-center left-[438px] overflow-clip p-[12px] rounded-[24px] top-[867px]">
          {/* Mic — muted (red split control) */}
          <div className="bg-[#601410] h-[48px] overflow-clip relative rounded-[12px] shrink-0 w-[88px]">
            <div className="-translate-y-1/2 absolute bg-[#f9dedc] overflow-clip right-0 rounded-[12px] size-[48px] top-1/2">
              <div className="absolute left-[12px] size-[24px] top-[12px]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={micOff} />
              </div>
            </div>
            <div className="-translate-y-1/2 absolute left-[14px] size-[20px] top-1/2">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={moreAudio} />
            </div>
          </div>
          {/* Camera — on (pill split control) */}
          <div className="bg-[#282a2c] h-[48px] overflow-clip relative rounded-[100px] shrink-0 w-[88px]">
            <div className="-translate-y-1/2 absolute bg-[#333537] overflow-clip right-0 rounded-[100px] size-[48px] top-1/2">
              <div className="-translate-x-1/2 -translate-y-1/2 absolute left-1/2 size-[24px] top-1/2">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={videocam} />
              </div>
            </div>
            <div className="-translate-y-1/2 absolute left-[14px] size-[20px] top-1/2">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={moreVideo} />
            </div>
          </div>
          <RoundControl icon={shareScreen} />
          <RoundControl icon={mood} />
          <RoundControl icon={closedCaption} />
          <RoundControl icon={backHand} />
          <RoundControl icon={moreVert} width={36} />
          <RoundControl icon={callEnd} width={72} bg="#dc362e" />
        </div>

        {/* Right pill — chat + meeting tools */}
        <div className="absolute bg-[#1e1f20] flex items-center left-[1314px] rounded-[9999px] top-[879px]">
          <div className="overflow-clip relative rounded-[100px] shrink-0 size-[48px]">
            <div className="absolute left-[12px] size-[24px] top-[12px]">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={chat} />
            </div>
          </div>
          <div className="overflow-clip relative rounded-[100px] shrink-0 size-[48px]">
            <div className="absolute left-[12px] size-[24px] top-[12px]">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={lockPerson} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

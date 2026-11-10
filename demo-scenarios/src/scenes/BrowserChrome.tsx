import favicon from '../assets/meet/favicon.png'
import userProfile from '../assets/meet/user-profile.png'
import iconMore from '../assets/meet/icon-more.svg'
import iconStar from '../assets/meet/icon-star.svg'
import iconSecure from '../assets/meet/icon-secure.svg'
import iconHome from '../assets/meet/icon-home.svg'
import iconRefresh from '../assets/meet/icon-refresh.svg'
import iconForward from '../assets/meet/icon-forward.svg'
import iconBack from '../assets/meet/icon-back.svg'
import curveL from '../assets/meet/curve-l.svg'
import curveR from '../assets/meet/curve-r.svg'
import iconClose from '../assets/meet/icon-close.svg'
import iconNewTab from '../assets/meet/icon-new-tab.svg'
import browserControls from '../assets/meet/browser-controls.svg'

const roboto = { fontFamily: "'Roboto', sans-serif" }

interface BrowserChromeProps {
  tabTitle: string
  /** Rendered white (the "real" host part), e.g. "meet.google.com" */
  urlHost: string
  /** Rendered muted, e.g. "/uir-wmte-coi?authuser=2" */
  urlPath: string
}

/** Dark Chrome window chrome (80px): traffic lights + tab strip + URL bar.
 *  Shared by every browser-framed scene; built from Figma 666:1511. */
export function BrowserChrome({ tabTitle, urlHost, urlPath }: BrowserChromeProps) {
  return (
    <div className="absolute h-[80px] left-0 overflow-clip right-0 top-0">
      {/* Tab strip */}
      <div className="absolute inset-[0_0_47.5%_0]">
        <div className="absolute inset-0 overflow-clip">
          <div className="absolute bg-[#202124] inset-0 shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]" />
          <div className="-translate-y-1/2 absolute h-[34px] left-[72px] top-[calc(50%+4px)] w-[167px]">
            <div className="-translate-y-1/2 absolute h-[34px] left-[8px] top-1/2 w-[131px]">
              <div className="absolute flex gap-[8px] items-center left-[-6px] top-0">
                <div className="flex items-start relative shrink-0">
                  <div className="h-[8px] relative shrink-0 w-[6px]">
                    <img alt="" className="absolute block inset-0 max-w-none size-full" src={curveL} />
                  </div>
                  <div className="bg-[#35363a] flex gap-[9px] items-center overflow-clip p-[8px] relative rounded-tl-[8px] rounded-tr-[8px] shrink-0">
                    <div className="relative shrink-0 size-[16px]">
                      <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={favicon} />
                    </div>
                    <div className="flex flex-col font-normal justify-center leading-[0] relative shrink-0 text-[12px] text-white tracking-[0.2px] whitespace-nowrap" style={roboto}>
                      <p className="leading-[normal]">{tabTitle}</p>
                    </div>
                    <div className="relative shrink-0 size-[18px]">
                      <div className="absolute inset-[29.17%]">
                        <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconClose} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center relative shrink-0">
                    <div className="-scale-y-100 flex-none rotate-180">
                      <div className="h-[8px] relative w-[6px]">
                        <img alt="" className="absolute block inset-0 max-w-none size-full" src={curveR} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="relative shrink-0 size-[20px]">
                  <div className="absolute inset-[16.67%]">
                    <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconNewTab} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="-translate-y-1/2 absolute h-[12px] left-[13px] top-[calc(50%+0.5px)] w-[52px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={browserControls} />
          </div>
        </div>
      </div>

      {/* URL bar */}
      <div className="absolute h-[38px] left-0 right-0 top-[42px]">
        <div className="absolute h-[38px] left-0 overflow-clip right-0 top-0">
          <div aria-hidden className="absolute bg-[#35363a] inset-0 pointer-events-none" />
          <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0px_-1px_0px_0px_#dadce0]" />
          <div className="-translate-y-1/2 absolute h-[22px] overflow-clip right-[14px] top-1/2 w-[51px]">
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%+17.5px)] size-[16px] top-1/2">
              <div className="absolute inset-[12.5%_39.58%_12.5%_41.67%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconMore} />
              </div>
            </div>
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%-14.5px)] size-[22px] top-1/2">
              <img alt="" className="absolute block inset-0 max-w-none size-full" height="22" src={userProfile} width="22" />
            </div>
          </div>
          <div className="-translate-y-1/2 absolute h-[28px] left-[134px] overflow-clip right-[81px] top-1/2">
            <div className="-translate-y-1/2 absolute bg-[#202124] h-[28px] left-0 right-0 rounded-[14px] top-1/2" />
            <div className="-translate-y-1/2 absolute right-[10px] size-[16px] top-1/2">
              <div className="absolute inset-[12.5%_12.5%_15.79%_12.5%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconStar} />
              </div>
            </div>
            <div className="-translate-y-1/2 absolute h-[16px] left-[33px] top-1/2 w-[400px]">
              <div className="absolute flex font-normal items-center leading-[0] left-0 text-[14px] top-0 tracking-[0.25px] whitespace-nowrap" style={roboto}>
                <div className="flex flex-col justify-center relative shrink-0 text-white">
                  <p>
                    <span className="leading-[normal] text-[#86888a]">https://</span>
                    <span className="leading-[normal]">{urlHost}</span>
                  </p>
                </div>
                <div className="flex flex-col justify-center relative shrink-0 text-[#86888a]">
                  <p className="leading-[normal]">{urlPath}</p>
                </div>
              </div>
            </div>
            <div className="-translate-y-1/2 absolute left-[11px] size-[12px] top-1/2">
              <div className="absolute inset-[4.17%_16.67%_8.33%_16.67%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconSecure} />
              </div>
            </div>
          </div>
          <div className="-translate-y-1/2 absolute h-[16px] left-[12px] overflow-clip top-1/2 w-[109px]">
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%+46.5px)] size-[16px] top-1/2">
              <div className="absolute inset-[12.53%_12.49%_12.5%_12.49%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconHome} />
              </div>
            </div>
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%+15.5px)] size-[16px] top-1/2">
              <div className="absolute inset-[12.5%_12.51%_12.51%_12.5%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconRefresh} />
              </div>
            </div>
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%-15.5px)] size-[16px] top-1/2">
              <div className="absolute inset-[12.5%_12.5%_14.41%_12.5%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconForward} />
              </div>
            </div>
            <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%-46.5px)] size-[16px] top-1/2">
              <div className="absolute inset-[12.5%_12.5%_14.46%_12.5%]">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={iconBack} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

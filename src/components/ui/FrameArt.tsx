/* eslint-disable better-tailwindcss/no-restricted-classes --
   This file draws a picture of a Figma frame: a mock of somebody else's screen,
   shown inside Peek. Its palette is a fixed light canvas on purpose, so the art
   reads the same in all four of Peek's themes — a design that followed the
   theme would make a screenshot change colour when the reader changed theirs.
   Tokens are for Peek's own surfaces; there is no token for "a picture of a
   different product", and inventing one would be the wrong shape. */
import { cn } from '@/lib/utils'
import type { FigmaFrame } from '@/api'

/**
 * Mock render of a Figma frame's contents. Fixed light "canvas" palette on
 * purpose - these read as screenshots of designed screens, not as app UI, so
 * they stay identical across Peek's light/dark themes. Percentage-based layout
 * so the same art scales from a grid thumbnail to the full-screen preview.
 */
export function FrameArt({ frame, className }: { frame: FigmaFrame; className?: string }) {
  const mobile = frame.kind === 'mobile'
  return (
    <div
      className={cn(
        'bg-white rounded-[6px] overflow-hidden flex flex-col shadow-sm shrink-0',
        mobile ? 'aspect-[9/18]' : 'aspect-[16/10]',
        className
      )}
    >
      {frame.art === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-[6%] p-[10%]">
          <div className="w-[32%] aspect-square rounded-full bg-amber-100 flex items-center justify-center">
            <div className="w-[38%] aspect-square rounded-sm bg-amber-400 rotate-45" />
          </div>
          <div className="w-[70%] h-[3.5%] rounded-full bg-gray-800" />
          <div className="w-[85%] h-[2.5%] rounded-full bg-gray-300" />
          <div className="w-[60%] h-[2.5%] rounded-full bg-gray-300" />
          <div className="w-[80%] h-[7%] rounded-full bg-violet-600 mt-[8%]" />
          <div className="w-[45%] h-[2.5%] rounded-full bg-gray-300" />
        </div>
      )}
      {frame.art === 'error-first-launch' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-[6%] p-[10%]">
          <div className="w-[45%] aspect-square rounded-lg bg-gray-100 flex items-center justify-center">
            <div className="w-[40%] aspect-square rounded-full border-4 border-dashed border-gray-300" />
          </div>
          <div className="w-[65%] h-[3.5%] rounded-full bg-gray-800" />
          <div className="w-[80%] h-[2.5%] rounded-full bg-gray-300" />
          <div className="w-[80%] h-[7%] rounded-full bg-violet-600 mt-[8%]" />
        </div>
      )}
      {frame.art === 'guidance-a' && (
        <div className="flex-1 flex flex-col items-center p-[8%] gap-[5%]">
          <div className="w-full h-[42%] rounded-lg bg-violet-100 flex items-center justify-center">
            <div className="w-[30%] aspect-square rounded-full bg-violet-400" />
            <div className="w-[18%] aspect-square rounded-sm bg-amber-300 -ml-[10%] mt-[18%]" />
          </div>
          <div className="flex gap-[3%] items-center">
            <div className="w-2 h-2 rounded-full bg-violet-600" />
            <div className="w-2 h-2 rounded-full bg-gray-300" />
            <div className="w-2 h-2 rounded-full bg-gray-300" />
          </div>
          <div className="w-[75%] h-[3.5%] rounded-full bg-gray-800" />
          <div className="w-[88%] h-[2.5%] rounded-full bg-gray-300" />
          <div className="w-[70%] h-[2.5%] rounded-full bg-gray-300" />
        </div>
      )}
      {frame.art === 'guidance-b' && (
        <div className="flex-1 flex flex-col items-center p-[8%] gap-[5%]">
          <div className="w-full h-[42%] rounded-lg bg-sky-100 flex items-center justify-center">
            <div className="w-[26%] aspect-square rounded-full bg-white shadow flex items-center justify-center">
              <div
                className="w-0 h-0 ml-[8%]"
                style={{
                  borderTop: '7px solid transparent',
                  borderBottom: '7px solid transparent',
                  borderLeft: '11px solid #0284c7',
                }}
              />
            </div>
          </div>
          <div className="flex gap-[3%] items-center">
            <div className="w-2 h-2 rounded-full bg-gray-300" />
            <div className="w-2 h-2 rounded-full bg-sky-600" />
            <div className="w-2 h-2 rounded-full bg-gray-300" />
          </div>
          <div className="w-[75%] h-[3.5%] rounded-full bg-gray-800" />
          <div className="w-[88%] h-[2.5%] rounded-full bg-gray-300" />
        </div>
      )}
      {frame.art === 'welcome' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-[6%] p-[10%]">
          <div className="w-[28%] aspect-square rounded-2xl bg-violet-600" />
          <div className="w-[60%] h-[4%] rounded-full bg-gray-800" />
          <div className="w-[75%] h-[2.5%] rounded-full bg-gray-300" />
          <div className="flex-1" />
          <div className="w-[85%] h-[7%] rounded-full bg-violet-600" />
          <div className="w-[85%] h-[7%] rounded-full bg-gray-100 border border-gray-300" />
        </div>
      )}
      {frame.art === 'account-setup' && (
        <div className="flex-1 flex flex-col p-[10%] gap-[4.5%]">
          <div className="w-[55%] h-[4%] rounded-full bg-gray-800" />
          <div className="w-[75%] h-[2.5%] rounded-full bg-gray-300 mb-[4%]" />
          <div className="w-full h-[8%] rounded-md bg-gray-100 border border-gray-300" />
          <div className="w-full h-[8%] rounded-md bg-gray-100 border border-gray-300" />
          <div className="w-full h-[8%] rounded-md bg-gray-100 border border-gray-300" />
          <div className="flex-1" />
          <div className="w-full h-[8%] rounded-full bg-violet-600" />
        </div>
      )}
      {frame.art === 'export-loading' && (
        <div className="flex-1 flex flex-col p-[5%] gap-[4%]">
          <div className="flex gap-[2%] items-center">
            <div className="w-[10%] h-[8%] rounded-sm bg-violet-600" />
            <div className="w-[24%] h-[5%] rounded-full bg-gray-300" />
            <div className="flex-1" />
            <div className="w-[8%] aspect-square rounded-full bg-gray-200" />
          </div>
          <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 flex flex-col items-center justify-center gap-[6%]">
            <div className="w-[12%] aspect-square rounded-full border-4 border-gray-200 border-t-violet-600" />
            <div className="w-[36%] h-[5%] rounded-full bg-gray-800" />
            <div className="w-[50%] h-[4%] rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
              <div className="w-[60%] h-full bg-violet-500" />
            </div>
          </div>
        </div>
      )}
      {frame.art === 'download-ready' && (
        <div className="flex-1 flex flex-col p-[5%] gap-[4%]">
          <div className="flex gap-[2%] items-center">
            <div className="w-[10%] h-[8%] rounded-sm bg-violet-600" />
            <div className="w-[24%] h-[5%] rounded-full bg-gray-300" />
          </div>
          <div className="flex flex-col gap-[3%] flex-1">
            <div className="w-full h-[9%] rounded-sm bg-gray-100" />
            <div className="w-full h-[9%] rounded-sm bg-gray-50" />
            <div className="w-full h-[9%] rounded-sm bg-gray-100" />
          </div>
          <div className="w-[55%] self-end rounded-md bg-white border border-gray-300 shadow-md p-[3%] flex items-center gap-[4%]">
            <div className="w-[12%] aspect-square rounded-full bg-emerald-500 shrink-0" />
            <div className="flex flex-col gap-[8%] flex-1 py-[2%]">
              <div className="w-[80%] h-1 rounded-full bg-gray-800" />
              <div className="w-[55%] h-1 rounded-full bg-gray-300" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

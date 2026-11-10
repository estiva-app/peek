import { useEffect, useMemo, useState, type ReactNode } from 'react'

// ── Scenario player ──
//
// Fixed 1440×1024 stage auto-scaled to the window. → / ← (or click /
// shift-click) advances / rewinds one STEP. A step is either an in-scene
// beat (the scene re-renders with a higher local step and animates the
// difference) or a scene change (plain crossfade — no morphing, by ruling).
// Deep link: ?scenario=1&step=3. Built to be screen-recorded: keyboard-only,
// no chrome around the stage, background pure black.

export interface Scene {
  id: string
  /** How many steps this scene owns (>= 1). Local step 0 = scene just shown. */
  steps: number
  render: (localStep: number) => ReactNode
}

export interface Scenario {
  id: number
  title: string
  scenes: Scene[]
}

const STAGE_W = 1440
const STAGE_H = 1024

/** Global step index → { scene index, local step }. */
function locate(scenes: Scene[], globalStep: number): { scene: number; local: number } {
  let remaining = globalStep
  for (let i = 0; i < scenes.length; i++) {
    if (remaining < scenes[i].steps) return { scene: i, local: remaining }
    remaining -= scenes[i].steps
  }
  const last = scenes.length - 1
  return { scene: last, local: scenes[last].steps - 1 }
}

export function Player({ scenarios }: { scenarios: Scenario[] }) {
  const params = new URLSearchParams(window.location.search)
  const scenarioId = Number(params.get('scenario') ?? scenarios[0].id)
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]
  const totalSteps = useMemo(
    () => scenario.scenes.reduce((n, s) => n + s.steps, 0),
    [scenario]
  )

  const [step, setStep] = useState(() =>
    Math.min(Math.max(Number(params.get('step') ?? 0), 0), totalSteps - 1)
  )
  const [scale, setScale] = useState(1)
  const [hud, setHud] = useState(() => params.get('hud') !== '0')

  // Keep the URL shareable as you step through.
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('scenario', String(scenario.id))
    url.searchParams.set('step', String(step))
    window.history.replaceState(null, '', url)
  }, [scenario.id, step])

  useEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        setStep((s) => Math.min(s + 1, totalSteps - 1))
      } else if (e.key === 'ArrowLeft') {
        setStep((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Home') {
        setStep(0)
      } else if (e.key === 'h' || e.key === 'H') {
        setHud((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [totalSteps])

  const { scene: sceneIdx, local } = locate(scenario.scenes, step)
  const scene = scenario.scenes[sceneIdx]

  return (
    <div
      className="player"
      onClick={(e) => {
        if (e.shiftKey) setStep((s) => Math.max(s - 1, 0))
        else setStep((s) => Math.min(s + 1, totalSteps - 1))
      }}
    >
      <div
        className="stage"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        {/* key on scene id → remount per scene → CSS crossfade-in */}
        <div key={scene.id} className="scene">
          {scene.render(local)}
        </div>
      </div>
      {/* Hidden with ?hud=0 or the H key — keep it out of recordings. */}
      {hud && (
        <div className="hud">
          S{scenario.id} · {scene.id} · step {step + 1}/{totalSteps} — → next, ← back
        </div>
      )}
    </div>
  )
}

import type { Strike } from '../combat/CombatSystem'
import { superTiming, uppercutTiming, type Balance } from '../combat/balance'
import { uppercutFrame } from '../combat/Uppercut'
import type { HintKind } from './Onboarding'

export interface TutorialDemo {
  kind: HintKind
  age: number
  strike?: Strike
  superAge?: number
  boost: number
  x: number
  z: number
}

export function tutorialDemo(seconds: number, balance: Balance, reduced: boolean): TutorialDemo {
  const cycle = Math.floor(seconds / 8)
  const phase = seconds % 8
  const step = Math.floor(phase / 2)
  const age = phase % 2
  const kind: HintKind = step === 0 ? 'punch' : step === 1 ? 'side' : step === 2 ? 'superDash' : 'uppercut'
  const demo: TutorialDemo = { kind, age, boost: 0, x: 0, z: 0 }
  if (kind === 'punch') {
    const starts = [0.20, 0.82, 1.07, 1.32]
    const index = reduced ? 0 : age >= starts[3] ? 3 : age >= starts[2] ? 2 : age >= starts[1] ? 1 : age >= starts[0] ? 0 : -1
    if (index >= 0) demo.strike = { kind, hand: index % 2 ? 'right' : 'left',
      at: -(reduced ? 0.08 : age - starts[index]), aim: 0, hit: false }
  } else if (kind === 'side') {
    const left = age < 1
    const time = (age % 1) - 0.15
    if (reduced || time >= 0) demo.strike = { kind: left ? 'sideLeft' : 'sideRight', hand: left ? 'left' : 'right',
      at: -(reduced ? 0.07 : time), aim: 0, hit: false }
    demo.x = reduced ? 0 : (left ? -1 : 1) * Math.sin(Math.PI * Math.min(1, Math.max(0, time / 0.7))) * 0.60
  } else if (kind === 'superDash') {
    const { duration, prepare, cruiseEnd } = superTiming(balance)
    const time = (age - 0.20) * Math.max(1, duration / 1.45)
    if (reduced || (time >= 0 && time <= duration)) demo.superAge = reduced ? (prepare + cruiseEnd) / 2 : time
    if (!reduced && time >= prepare && time <= duration) {
      demo.boost = Math.min(1, Math.max(0, (duration - time) / Math.max(0.01, duration - cruiseEnd)))
      demo.z = Math.sin(Math.PI * Math.min(1, (time - prepare) / (duration - prepare))) * 2.8
    }
  } else {
    const timing = uppercutTiming(balance)
    const time = (age - 0.35) * Math.max(1, timing.duration / 1.25)
    if (reduced || time >= 0) demo.strike = { kind, hand: cycle % 2 ? 'right' : 'left',
      at: -(reduced ? timing.windup + timing.drive * 0.9 : time), aim: 0, hit: false }
    if (!reduced) {
      const sample = uppercutFrame(time, timing)
      demo.z = Math.max(-timing.retreat, (balance.speed - timing.brake) * timing.windup) * sample.compression +
        timing.distance * sample.progress * sample.wave
    }
  }
  return demo
}

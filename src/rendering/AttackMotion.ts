import { superTiming, uppercutTiming, type Balance } from '../combat/balance'
import { uppercutFrame } from '../combat/Uppercut'
import type { CombatEvent, PunchSource, Strike } from '../combat/CombatSystem'

const unit = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => x * x * (3 - 2 * x)

export function superHandMotion(age: number, balance: Balance) {
  const { duration, prepare, fade, cruiseEnd, handsReady } = superTiming(balance)
  if (age < 0 || age >= duration) return 0
  if (age < prepare) return -ease(age / prepare) * 0.52
  if (age < handsReady) return -0.52 + ease(unit((age - prepare) / (handsReady - prepare))) * 1.52
  return fade && age > cruiseEnd ? ease(unit((duration - age) / fade)) : 1
}

export function uppercutHandMotion(age: number, balance: Balance) {
  return uppercutFrame(age, uppercutTiming(balance)).hand
}

export const holdJabHitstop = 0.022

/** Presentation only: never used to determine damage, reach or impulses. */
export function attackVisual(kind: Strike['kind'], source?: PunchSource, ideal = false) {
  const jab = kind === 'punch' && source === 'holdRepeat'
  return { jab, amplitude: jab ? 0.75 : 1, duration: jab ? 0.16 : 0.23,
    scale: jab ? 0.6 : 1, trail: jab ? 0.55 : 1,
    strength: kind === 'counter' ? ideal ? 1.6 : 1.3 : 1,
    flash: jab ? 0.6 : 1, rays: jab ? 3 : 7, reaction: jab ? 0.55 : 1 }
}

export function impactVisual(event: Pick<CombatEvent, 'kind' | 'attackKind' | 'punchSource'>) {
  const kind = event.attackKind ?? (event.kind === 'counter' || event.kind === 'ideal' ? 'counter' : 'punch')
  const visual = attackVisual(kind, event.kind === 'hit' && kind === 'punch' ? event.punchSource : undefined, event.kind === 'ideal')
  return { ...visual, hitstop: visual.jab ? holdJabHitstop :
    event.kind === 'ideal' || event.kind === 'air' ? 0.085 : 0.047 }
}

export function punchHandMotion(age: number, duration: number, source?: PunchSource) {
  const p = attackVisual('punch', source)
  if (age < 0 || age >= duration) return 0
  const windup = Math.min(duration * 0.1, p.jab ? 0.008 : 0.018)
  if (age < windup) return -(p.jab ? 0.04 : 0.10) * Math.sin(age / windup * Math.PI)
  const time = unit((age - windup) / (duration - windup))
  return Math.sin(time ** 0.61 * Math.PI) * p.amplitude
}

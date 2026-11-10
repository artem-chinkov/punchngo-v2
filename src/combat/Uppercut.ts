import type { uppercutTiming } from './balance'

export type UppercutProfile = ReturnType<typeof uppercutTiming>
export interface UppercutState {
  age: number
  profile: UppercutProfile
  retreated: number
  hit: boolean
  missed: boolean
}

const unit = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => n * n * (3 - 2 * n)

/** Shared simulation/visual clock; the wave front is the actual damage boundary. */
export function uppercutFrame(age: number, p: UppercutProfile) {
  const active = age >= 0 && age < p.duration
  const progress = unit((age - p.windup) / p.drive)
  const compression = !active ? 0 : age < p.windup ? ease(age / p.windup) : 1 - ease(unit(progress * 2))
  const wave = !active || age < p.windup ? 0 : age < p.driveEnd ? 1 :
    ((p.duration - age) / p.recovery) ** 2
  return { active, driving: active && age >= p.windup && age < p.driveEnd,
    progress, reach: p.reach * progress, compression, wave, cameraDip: compression * 4,
    hand: !active ? 0 : age < p.windup ? -compression * 0.32 : age < p.driveEnd ?
      -0.32 + (1 - (1 - progress) ** 3) * 1.32 : ease(unit((p.duration - age) / p.recovery)) }
}

export function uppercutSpeed(age: number, p: UppercutProfile) {
  if (age < 0 || age >= p.duration) return 0
  if (age < p.windup) return -p.brake
  if (age < p.driveEnd) return p.peak * (1 - 0.9 * (age - p.windup) / p.drive)
  return p.peak * 0.1 * (p.duration - age) / p.recovery
}

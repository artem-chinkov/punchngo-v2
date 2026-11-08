import { superTiming, uppercutTiming, type Balance } from '../combat/balance'

const unit = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => x * x * (3 - 2 * x)

export function superHandMotion(age: number, balance: Balance) {
  const { duration, prepare, fade, cruiseEnd } = superTiming(balance)
  if (age < 0 || age >= duration) return 0
  if (age < prepare) return -ease(age / prepare) * 0.52
  if (age < prepare + 0.09) return -0.52 + ease(unit((age - prepare) / 0.09)) * 1.52
  return fade && age > cruiseEnd ? ease(unit((duration - age) / fade)) : 1
}

export function uppercutHandMotion(age: number, balance: Balance) {
  const { duration, windup, drive } = uppercutTiming(balance)
  if (age < 0 || age >= duration) return 0
  if (age < windup) return -ease(age / windup) * 0.22
  if (age < windup + drive) return -0.22 + (1 - (1 - unit((age - windup) / drive)) ** 3) * 1.22
  return ease(unit((duration - age) / (duration - windup - drive)))
}

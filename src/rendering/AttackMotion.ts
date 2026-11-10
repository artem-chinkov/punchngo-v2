import { superTiming, uppercutTiming, type Balance } from '../combat/balance'
import { uppercutFrame } from '../combat/Uppercut'

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

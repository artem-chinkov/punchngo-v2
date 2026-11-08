import type { Balance } from '../combat/balance'
import { laneX, type Lane } from '../world/route'

export class Runner {
  z = 0
  previousZ = 0
  x = 0
  lane: Lane = 0
  speed: number
  dash = 0
  private dashAge = Infinity
  private dashPower = 0
  private laneAge = Infinity
  private laneFrom = 0

  constructor(private readonly balance: Balance) { this.speed = balance.speed }

  changeLane(direction: -1 | 1) {
    if (this.laneAge < this.balance.laneDuration) return false
    const next = Math.min(1, Math.max(-1, this.lane + direction)) as Lane
    if (next === this.lane) return false
    this.laneFrom = this.x
    this.lane = next
    this.laneAge = 0
    return true
  }

  launchDash(bonus: number) {
    this.dashAge = 0
    this.dashPower = Math.min(this.balance.dashLimit - 1, (this.balance.dashMultiplier - 1) * bonus)
    this.dash = this.dashPower
  }

  advance(dt: number) {
    this.previousZ = this.z
    const laneProgress = Math.min(1, (this.laneAge += dt) / this.balance.laneDuration)
    const ease = laneProgress * laneProgress * (3 - 2 * laneProgress)
    this.x = this.laneFrom + (laneX(this.lane) - this.laneFrom) * ease
    const power = this.dashPower
    const duration = this.balance.dashDuration
    const from = Math.min(duration, this.dashAge)
    const to = Math.min(duration, this.dashAge + dt)
    this.z += this.balance.speed * (dt + power * (to - from) * (1 - (to + from) / (2 * duration)))
    this.dashAge += dt
    this.dash = power * Math.max(0, 1 - this.dashAge / duration)
    this.speed = this.balance.speed * (1 + this.dash)
  }
}

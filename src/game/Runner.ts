import { superTiming, type Balance } from '../combat/balance'
import { laneX, type Lane } from '../world/route'

const holdRecoveryDuration = 0.2

export class Runner {
  z = 0
  previousZ = 0
  previousX = 0
  x = 0
  lane: Lane = 0
  speed: number
  dash = 0
  superAge = Infinity
  superBoost = 0
  superSweepFrom = 1
  superSweepTo = 0
  superSweepZFrom = 0
  superSweepZTo = 0
  private dashAge = Infinity
  private dashPower = 0
  private holdPenalty = 0
  private laneAge = Infinity
  private laneFrom = 0

  constructor(private readonly balance: Balance) { this.speed = balance.speed }

  get superActive() { return this.superAge + 1e-9 < this.balance.superDuration }
  get spawnSpeed() { return this.superActive ? Math.max(this.speed, this.balance.speed * this.balance.superSpeed) : this.speed }
  get superHandsReady() { return !this.superActive || this.superAge + 1e-9 >= superTiming(this.balance).handsReady }

  // Restrict proposed travel before rendering/contact resolution, without
  // restarting the speed profile or moving the camera backwards.
  limitForward(z: number) {
    this.z = Math.max(this.previousZ, Math.min(this.z, z))
    this.superSweepZFrom = Math.min(this.superSweepZFrom, this.z)
    this.superSweepZTo = Math.min(this.superSweepZTo, this.z)
  }
  canChangeLane(direction: -1 | 1) {
    return this.laneAge + 1e-9 >= this.balance.laneDuration && Math.abs(this.lane + direction) <= 1
  }

  changeLane(direction: -1 | 1) {
    if (!this.canChangeLane(direction)) return false
    const next = Math.min(1, Math.max(-1, this.lane + direction)) as Lane
    if (next === this.lane) return false
    this.laneFrom = this.x
    this.lane = next
    this.laneAge = 0
    return true
  }

  launchDash(bonus: number) {
    if (this.superActive) return
    this.dashAge = 0
    this.dashPower = Math.min(this.balance.dashLimit - 1, (this.balance.dashMultiplier - 1) * bonus)
    this.dash = this.dashPower
  }

  launchSuper() {
    if (this.superActive) return false
    this.dashAge = Infinity
    this.dashPower = this.dash = 0
    this.speed = this.balance.speed
    this.superAge = this.superBoost = 0
    return true
  }

  stopSuper() {
    if (!this.superActive && !this.superBoost) return
    this.superAge = Infinity
    this.superBoost = 0
    this.speed = this.balance.speed * (1 - this.holdPenalty)
  }

  clearHold() {
    if (!this.holdPenalty) return
    this.holdPenalty = 0
    if (!this.superActive) this.speed = this.balance.speed * (1 + this.dash)
  }

  // Integrate lost distance, including steps where the penalty reaches either bound.
  private advanceHold(dt: number, holding: boolean) {
    const rate = this.balance.holdSlowdownPerSecond / 100
    const limit = 1 - this.balance.holdMinSpeedPercent / 100
    if (rate <= 0 || limit <= 0) {
      this.holdPenalty = 0
      return 0
    }
    const from = Math.min(this.holdPenalty, limit)
    const target = holding ? limit : 0
    const slope = holding ? rate : -limit / holdRecoveryDuration
    const timeToTarget = (target - from) / slope
    const ramp = Math.min(dt, timeToTarget)
    this.holdPenalty = dt >= timeToTarget ? target : from + slope * ramp
    return (from + this.holdPenalty) * 0.5 * ramp + target * (dt - ramp)
  }

  advance(dt: number, holding = false) {
    this.previousZ = this.z
    this.previousX = this.x
    this.superSweepFrom = 1
    this.superSweepTo = 0
    const laneProgress = Math.min(1, (this.laneAge += dt) / this.balance.laneDuration)
    const ease = laneProgress * laneProgress * (3 - 2 * laneProgress)
    this.x = this.laneFrom + (laneX(this.lane) - this.laneFrom) * ease
    if (this.superActive) {
      const { duration, prepare, fade, cruiseEnd } = superTiming(this.balance)
      const age = this.superAge
      const next = age + dt
      const peak = this.balance.superSpeed - 1
      const area = (at: number) => {
        const cruise = Math.max(0, Math.min(at, cruiseEnd) - prepare)
        const tail = Math.max(0, Math.min(at - cruiseEnd, fade))
        return peak * (cruise + (fade ? tail * (1 - tail / (2 * fade)) : 0))
      }
      const distance = (at: number) => this.balance.speed * (at - age + area(at) - area(age))
      const from = Math.max(age, prepare)
      const to = Math.min(next, duration)
      if (to > from) {
        this.superSweepFrom = (from - age) / dt
        this.superSweepTo = (to - age) / dt
        this.superSweepZFrom = this.z + distance(from)
        this.superSweepZTo = this.z + distance(to)
      }
      const superStep = Math.min(dt, duration - age)
      this.advanceHold(superStep, holding)
      const postSuperLoss = this.advanceHold(dt - superStep, holding)
      this.z += distance(next) - this.balance.speed * postSuperLoss
      this.superAge = next
      this.superBoost = next < prepare || next + 1e-9 >= duration ? 0 :
        peak * (next <= cruiseEnd || !fade ? 1 : Math.max(0, 1 - (next - cruiseEnd) / fade))
      this.speed = this.balance.speed * (1 + this.superBoost - (this.superActive ? 0 : this.holdPenalty))
      return
    }
    const power = this.dashPower
    const duration = this.balance.dashDuration
    const from = Math.min(duration, this.dashAge)
    const to = Math.min(duration, this.dashAge + dt)
    const holdLoss = this.advanceHold(dt, holding)
    this.z += this.balance.speed * (dt - holdLoss + power * (to - from) * (1 - (to + from) / (2 * duration)))
    this.dashAge += dt
    this.dash = power * Math.max(0, 1 - this.dashAge / duration)
    this.speed = this.balance.speed * (1 + this.dash - this.holdPenalty)
  }
}

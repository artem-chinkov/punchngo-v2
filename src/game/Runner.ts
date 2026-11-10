import { superTiming, uppercutTiming, type Balance } from '../combat/balance'
import { uppercutSpeed, type UppercutState } from '../combat/Uppercut'
import { laneX, type Lane } from '../world/route'

const holdRecoveryDuration = 0.2
export interface MovementSegment { from: number; to: number; x0: number; x1: number; z0: number; z1: number }

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
  uppercut?: UppercutState
  uppercutStep?: { state: UppercutState; age: number; dt: number }
  readonly uppercutSegments: MovementSegment[] = []
  private dashAge = Infinity
  private dashPower = 0
  private holdPenalty = 0
  private laneAge = Infinity
  private laneFrom = 0

  constructor(private readonly balance: Balance) { this.speed = balance.speed }

  get superActive() { return this.superAge + 1e-9 < this.balance.superDuration }
  get uppercutActive() { return !!this.uppercut && this.uppercut.age + 1e-9 < this.uppercut.profile.duration }
  private get normalSpeed() { return this.balance.speed * (1 + this.dash - this.holdPenalty) }
  get spawnSpeed() { return this.superActive ? Math.max(this.speed, this.balance.speed * this.balance.superSpeed) :
    this.uppercutActive ? this.normalSpeed : this.speed }
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
    if (this.superActive || this.uppercutActive) return false
    this.dashAge = Infinity
    this.dashPower = this.dash = 0
    this.speed = this.balance.speed
    this.superAge = this.superBoost = 0
    return true
  }

  launchUppercut() {
    if (this.superActive || this.uppercutActive) return false
    const profile = uppercutTiming(this.balance)
    this.uppercut = { age: 0, profile, retreated: 0, hit: false, missed: false }
    this.speed = this.normalSpeed - profile.brake
    if (this.speed < 0 && (this.z <= 0 || profile.retreat === 0)) this.speed = 0
    return true
  }

  stopUppercut() {
    this.uppercut = undefined
    this.uppercutStep = undefined
    this.uppercutSegments.length = 0
    if (!this.superActive) this.speed = this.normalSpeed
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
    if (!this.superActive) {
      this.speed = this.normalSpeed + (this.uppercutActive ? uppercutSpeed(this.uppercut!.age, this.uppercut!.profile) : 0)
      if (this.speed < 0 && (this.z <= 0 || this.uppercut!.retreated >= this.uppercut!.profile.retreat)) this.speed = 0
    }
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
    this.uppercutSegments.length = 0
    this.uppercutStep = undefined
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
    if (this.uppercutActive) {
      this.advanceUppercut(dt, holding)
      return
    }
    this.z += this.advanceNormal(dt, holding)
    this.speed = this.normalSpeed
  }

  private advanceNormal(dt: number, holding: boolean) {
    const power = this.dashPower
    const duration = this.balance.dashDuration
    const from = Math.min(duration, this.dashAge)
    const to = Math.min(duration, this.dashAge + dt)
    const holdLoss = this.advanceHold(dt, holding)
    const distance = this.balance.speed * (dt - holdLoss + power * (to - from) * (1 - (to + from) / (2 * duration)))
    this.dashAge += dt
    this.dash = power * Math.max(0, 1 - this.dashAge / duration)
    return distance
  }

  private advanceUppercut(dt: number, holding: boolean) {
    const state = this.uppercut!, p = state.profile, age = state.age
    this.uppercutStep = { state, age, dt }
    const cuts = [0, dt]
    for (const at of [p.windup - age, p.driveEnd - age, p.duration - age, this.balance.dashDuration - this.dashAge]) {
      if (at > 1e-10 && at < dt) cuts.push(at)
    }
    const limit = 1 - this.balance.holdMinSpeedPercent / 100
    const rate = this.balance.holdSlowdownPerSecond / 100
    const holdTime = holding ? (limit - this.holdPenalty) / rate : this.holdPenalty * holdRecoveryDuration / limit
    if (holdTime > 1e-10 && holdTime < dt) cuts.push(holdTime)
    cuts.sort((a, b) => a - b)
    const segment = (from: number, to: number, distance: number) => {
      if (to - from < 1e-12) return
      const z0 = this.z
      this.z = Math.max(0, this.z + distance)
      const x = (t: number) => this.previousX + (this.x - this.previousX) * t / dt
      this.uppercutSegments.push({ from: from / dt, to: to / dt, x0: x(from), x1: x(to), z0, z1: this.z })
    }
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i], h = to - from
      if (h < 1e-12) continue
      const v0 = this.normalSpeed
      this.advanceNormal(h, holding)
      const v1 = this.normalSpeed
      const middle = age + (from + to) / 2
      // Evaluate the same side of each phase boundary (the speed jumps at release).
      const bonus = (at: number) => middle < p.windup ? -p.brake : middle < p.driveEnd ?
        p.peak * (1 - 0.9 * (at - p.windup) / p.drive) : middle < p.duration ?
          p.peak * 0.1 * (p.duration - at) / p.recovery : 0
      const start = v0 + bonus(age + from), finish = v1 + bonus(age + to)
      const slope = (finish - start) / h
      const turns = [0, h]
      if (start * finish < 0) turns.splice(1, 0, -start / slope)
      for (let j = 1; j < turns.length; j++) {
        const a = turns[j - 1], b = turns[j], span = b - a, velocity = start + slope * a
        const distance = velocity * span + slope * span * span / 2
        if (distance >= 0) segment(from + a, from + b, distance)
        else {
          const allowance = Math.max(0, Math.min(p.retreat - state.retreated, this.z))
          if (-distance <= allowance + 1e-12) {
            segment(from + a, from + b, distance)
            state.retreated += -distance
          } else {
            // Monotone half-segment: solve precisely where the retreat budget ends.
            let low = 0, high = span
            for (let n = 0; n < 44; n++) {
              const t = (low + high) / 2
              if (-(velocity * t + slope * t * t / 2) > allowance) high = t
              else low = t
            }
            segment(from + a, from + a + low, -allowance)
            segment(from + a + low, from + b, 0)
            state.retreated += allowance
          }
        }
      }
    }
    const nextAge = state.age + dt
    state.age = nextAge + 1e-9 >= p.duration ? p.duration :
      [p.windup, p.driveEnd].find(boundary => Math.abs(nextAge - boundary) < 1e-9) ?? nextAge
    this.speed = this.normalSpeed + uppercutSpeed(state.age, p)
    if (this.speed < 0 && (this.z <= 1e-10 || state.retreated >= p.retreat - 1e-10)) this.speed = 0
  }
}

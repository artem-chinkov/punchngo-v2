import type { EnemyType, Hand } from '../assets/ids'
import type { SfxCue } from '../audio/cues'
import type { Runner } from '../game/Runner'
import { Build, type UpgradeId } from '../game/upgrades'
import { laneAt, laneX, route, type Lane } from '../world/route'
import { createEnemy, EnemyAI, flightEdge, inCounterWindow, moveFlightPlanar, setPose, type Chain, type Enemy } from './EnemyAI'
import { superTiming, type Balance } from './balance'
import { sweepBodies, sweepBox, sweepGrowingBox } from './sweep'
import { DashPush } from './DashPush'

export type Effect = 'hit' | 'dashImpact' | 'ricochet' | 'counter' | 'ideal' | 'chain' | 'air' | 'wave' | 'electric' |
  'fire' | 'hurt' | 'miss' | 'rage' | 'finish' | 'level' | 'side' | 'landing' | 'bodyContact' | 'bodyShove'
type Side = -1 | 1
type Impact = { x: number; z: number; direction?: Side }
type Crossing = { enemy: Enemy; time: number }
const bodyWidth = 0.66
const bodyBehind = 0.18
const bodyAhead = 0.55
const bodyHeight = 0.8
const bodyClearance = 0.86
export interface CombatEvent {
  kind: Effect
  x: number
  z: number
  enemy?: number
  fromX?: number
  fromZ?: number
  points?: number
  direction?: Side
}
export interface Strike {
  hand: Hand
  kind: 'punch' | 'uppercut' | 'sideLeft' | 'sideRight' | 'counter' | 'finish'
  at: number
  aim: number
  hit: boolean
}
export type Special = 'superDash' | 'uppercut'
export type LearnedAction = 'punch' | 'side' | Special

export class CombatSystem {
  readonly enemies: Enemy[] = []
  readonly events: CombatEvent[] = []
  readonly audioCues: SfxCue[] = []
  readonly build = new Build()
  readonly learnedActions = new Set<LearnedAction>()
  readonly dashPush = new DashPush()
  hp: number
  xp = 0
  score = 0
  kills = 0
  combo = 0
  bestCombo = 0
  counters = 0
  perfect = 0
  damageTaken = 0
  damageCause = ''
  invulnerableUntil = 0
  strike?: Strike
  uppercutStrike?: Strike
  boss?: Enemy
  private readonly ai: EnemyAI
  private nextId = 1
  private hand: Hand = 'left'
  private uppercutHand: Hand = 'left'
  private specialDuration = 1
  private nextPunch = 0
  private lastTap = -Infinity
  private pendingTap?: number
  private nextSpecial = 0
  private holdBlockedUntil = 0
  private readonly landings: Enemy[] = []
  private readonly crossings: Crossing[] = []
  private readonly correctedX = new Map<number, number>()
  private comboLeft = 0

  constructor(readonly balance: Balance) {
    this.hp = balance.hp
    this.ai = new EnemyAI(balance)
  }

  get multiplier() { return this.combo >= 25 ? 3 : this.combo >= 12 ? 2 : this.combo >= 5 ? 1.5 : 1 }
  get punchInterval() { return Math.max(this.balance.minPunchInterval, this.balance.punchInterval / this.build.attackRate) }

  specialRemaining(now: number) { return Math.max(0, this.nextSpecial - now) }
  specialProgress(now: number) { return 1 - Math.min(1, this.specialRemaining(now) / this.specialDuration) }

  spawn(type: EnemyType, lane: Lane, z: number, now: number, scale = 1) {
    const enemy = createEnemy(this.nextId++, type, lane, z, Math.ceil(this.balance.enemies[type].hp * scale), now)
    this.enemies.push(enemy)
    if (type === 'bulldog') this.boss = enemy
    return enemy
  }

  counterTarget(runner: Runner, now: number) {
    let target: Enemy | undefined
    for (const enemy of this.enemies) {
      if (!inCounterWindow(enemy, now, this.balance)) continue
      const distance = enemy.z - runner.z
      if (distance < -0.3 || distance > this.balance.reach + 0.58) continue
      if (enemy.type === 'bulldog') return enemy
      if (Math.abs(enemy.x - runner.x) <= 0.83 && (!target || enemy.z < target.z)) target = enemy
    }
    return target
  }

  tap(runner: Runner, now: number) {
    if (!this.canStrike()) return false
    const counter = this.counterTarget(runner, now)
    if (!counter && !runner.superHandsReady) return false
    const ideal = !!counter && counter.until - now <= this.balance.idealWindow &&
      now - this.lastTap >= this.punchInterval * this.balance.idealTapGap
    this.lastTap = now
    if (counter) {
      this.counter(runner, now, counter, ideal)
      return true
    }
    if (this.punchReady(now)) {
      this.pendingTap = undefined
      this.punch(runner, now, this.build.acceleration)
      return true
    }
    if (this.nextPunch - now <= this.balance.inputBuffer) this.pendingTap = now
    return false
  }

  holdAttack(runner: Runner, now: number, dash = false) {
    if (!this.canStrike() || !runner.superHandsReady || this.pendingTap !== undefined || !this.punchReady(now) ||
      now < this.holdBlockedUntil) return false
    this.punch(runner, now, dash ? 1 : undefined)
    return true
  }

  special(runner: Runner, now: number, kind: Special) {
    if (!this.canStrike() || runner.superActive || runner.uppercutActive || this.specialRemaining(now) > 1e-9) return false
    if (kind === 'superDash') {
      if (!runner.launchSuper()) return false
      this.specialDuration = superTiming(this.balance).duration + this.balance.superRecovery
      this.dashPush.start(now)
      this.pendingTap = undefined
      this.audioCues.push('dash.start')
      if (this.build.rank('wave')) this.audioCues.push('upgrade.shockwave')
    } else {
      if (!runner.launchUppercut()) return false
      const timing = runner.uppercut!.profile
      this.specialDuration = Math.max(timing.duration, this.balance.specialCooldown)
      this.uppercutStrike = this.strike = { hand: this.uppercutHand, kind, at: now, aim: 0, hit: false }
      this.uppercutHand = this.uppercutHand === 'left' ? 'right' : 'left'
      this.audioCues.push('uppercut.windup')
    }
    this.nextSpecial = now + this.specialDuration
    this.learnedActions.add(kind)
    return true
  }

  clearUppercut(runner: Runner) {
    runner.stopUppercut()
    this.uppercutStrike = undefined
  }

  private resolveUppercutStep(runner: Runner, now: number, dt: number, invulnerable: boolean,
    attacks: { enemy: Enemy; at: number }[]) {
    const step = runner.uppercutStep!
    const state = step.state, p = state.profile
    for (const enemy of this.enemies) {
      const gap = enemy.previousZ - runner.previousZ
      if (enemy.contactSide && now >= enemy.contactUntil &&
        !(gap >= -bodyBehind - 0.08 && gap <= bodyAhead + 0.08 &&
          Math.abs(enemy.previousX - runner.previousX) <= bodyWidth + 0.08 && enemy.previousY <= bodyHeight + 0.08)) {
        enemy.contactSide = 0
      }
    }
    type Point = { x: number; z: number; y: number }
    const mix = (a: number, b: number, t: number) => a + (b - a) * t
    const unit = (t: number) => Math.max(0, Math.min(1, t))
    const paths = new Map(this.enemies.map(enemy => [enemy, { from: 0,
      start: { x: enemy.previousX, z: enemy.previousZ, y: enemy.previousY },
      end: { x: enemy.x, z: enemy.z, y: enemy.y } }]))
    const point = (enemy: Enemy, time: number): Point => {
      const path = paths.get(enemy)!, u = path.from >= 1 ? 1 : unit((time - path.from) / (1 - path.from))
      return { x: mix(path.start.x, path.end.x, u), z: mix(path.start.z, path.end.z, u), y: mix(path.start.y, path.end.y, u) }
    }
    const hero = (time: number) => {
      const segment = runner.uppercutSegments.find(part => time <= part.to + 1e-12) ?? runner.uppercutSegments.at(-1)!
      const u = unit((time - segment.from) / (segment.to - segment.from))
      return { x: mix(segment.x0, segment.x1, u), z: mix(segment.z0, segment.z1, u) }
    }
    const savePath = (enemy: Enemy, time: number, start: Point) => {
      paths.set(enemy, { from: time, start, end: { x: enemy.x, z: enemy.z, y: enemy.y } })
    }
    const handledAttacks = new Set<number>()
    const bodyContacts = new Set<number>()
    let cursor = 0
    // Only this ability uses this event ordering; ordinary combat and DashPush
    // retain their own flow. A changed flight gets a new path for the remainder.
    while (this.canStrike()) {
      let event: { enemy: Enemy; time: number; kind: 0 | 1 | 2; gap: number; attack?: number } | undefined
      const offer = (enemy: Enemy, time: number, kind: 0 | 1 | 2, gap = 0, attack?: number) => {
        if (!Number.isFinite(time) || time < cursor - 1e-10 || time > 1 + 1e-10) return
        if (!event || time < event.time - 1e-10 || (Math.abs(time - event.time) <= 1e-10 &&
          (kind < event.kind || (kind === event.kind && (gap < event.gap - 1e-10 ||
            (Math.abs(gap - event.gap) <= 1e-10 && enemy.id < event.enemy.id)))))) event = { enemy, time, kind, gap, attack }
      }
      attacks.forEach((attack, index) => {
        if (!handledAttacks.has(index)) offer(attack.enemy, unit((attack.at - (now - dt)) / dt), 0, 0, index)
      })
      for (const segment of runner.uppercutSegments) {
        const start = Math.max(cursor, segment.from), end = segment.to
        if (end < start + 1e-12) continue
        const h0 = hero(start), h1 = hero(end)
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0 || enemy.dashPushed) continue
          if (enemy.type !== 'bulldog' && !bodyContacts.has(enemy.id) && !enemy.contactSide && now >= enemy.contactUntil) {
            const a = point(enemy, start), b = point(enemy, end)
            // A retreat can enter a body from behind; a forward step keeps the
            // established one-sided contact rule.
            if (a.z - h0.z >= -bodyBehind || h1.z < h0.z) {
              const t = sweepBox(a.x - h0.x, a.z - h0.z, a.y, b.x - a.x - (h1.x - h0.x),
                b.z - a.z - (h1.z - h0.z), b.y - a.y, bodyWidth, bodyBehind, bodyAhead, bodyHeight)
              offer(enemy, mix(start, end, t), 1)
            }
          }
          if (state.hit || state.missed || enemy.pose === 'airborne' || enemy.landingWave) continue
          const from = Math.max(start, (p.windup - step.age) / dt)
          const to = Math.min(end, (p.driveEnd - step.age) / dt)
          if (to <= from + 1e-12) continue
          // Lane membership changes at the midpoint of a lane change, not at
          // its destination gesture. Split there before sweeping the lane box.
          const cuts = [from, to]
          if (segment.x1 !== segment.x0) for (const boundary of [-route.laneWidth / 2, route.laneWidth / 2]) {
            const t = segment.from + (boundary - segment.x0) / (segment.x1 - segment.x0) * (segment.to - segment.from)
            if (t > from + 1e-12 && t < to - 1e-12) cuts.push(t)
          }
          cuts.sort((a, b) => a - b)
          for (let i = 1; i < cuts.length; i++) {
            const aTime = cuts[i - 1], bTime = cuts[i]
            const a = point(enemy, aTime), b = point(enemy, bTime), ha = hero(aTime), hb = hero(bTime)
            const lane = laneAt(hero((aTime + bTime) / 2).x)
            const reach = (t: number) => p.reach * unit((step.age + dt * t - p.windup) / p.drive)
            const t = sweepGrowingBox(a.x - laneX(lane), a.z - ha.z, a.y, b.x - a.x,
              b.z - a.z - (hb.z - ha.z), b.y - a.y, route.laneWidth / 2, reach(aTime), reach(bTime), 0.05)
            const time = mix(aTime, bTime, t)
            if (Number.isFinite(t) && laneAt(point(enemy, Math.min(bTime, time + 1e-9)).x) === lane) {
              offer(enemy, time, 2, point(enemy, time).z - hero(time).z)
            }
          }
        }
      }
      if (!event) break
      const { enemy, time, kind } = event
      cursor = time
      const at = now - dt + time * dt, position = point(enemy, time), h = hero(time)
      if (kind === 0) {
        handledAttacks.add(event.attack!)
        const gap = position.z - h.z
        if (!invulnerable && enemy.hp > 0 && enemy.pose === 'attack' && gap > -0.4 &&
          gap <= (enemy.type === 'bulldog' ? 3.55 : 2.65) &&
          (enemy.type === 'bulldog' || Math.abs(position.x - h.x) < 0.84)) {
          this.hurt(enemy, this.balance.enemies[enemy.type].damage, at, 'attack', runner)
        }
      } else if (kind === 1) {
        bodyContacts.add(enemy.id)
        const flight = enemy.chain, flying = at < enemy.flightUntil || position.y > 0
        const direction = this.shoveSide(enemy, h.x, position.x)
        this.events.push({ kind: flying ? 'bodyShove' : 'bodyContact', enemy: enemy.id, ...position, direction })
        if (!flying) {
          this.audioCues.push('enemy.collision')
          if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].contact, at, 'contact', runner)
        }
        this.shove(enemy, flight ?? { kind: 'body', visited: new Set([enemy.id]) }, flight ? enemy.depth : 0,
          { ...position, direction }, 8.4, 4.3, at, 0.38, dt * (1 - time))
        savePath(enemy, time, position)
      } else {
        state.hit = true
        const strike = this.uppercutStrike!
        strike.aim = position.x - h.x
        strike.hit = true
        enemy.x = position.x
        enemy.z = position.z
        enemy.y = position.y
        this.audioCues.push('uppercut.impact')
        this.hit(enemy, this.baseDamage * this.balance.uppercutDamage, at, 'air')
        if (this.canDisplace(enemy)) {
          const chain: Chain = { kind: 'uppercut', visited: new Set([enemy.id]) }
          const lift = enemy.type === 'bulldog' ? 0 : this.balance.uppercutLift
          this.impulse(enemy, chain, 0, 0, this.force * this.balance.uppercutForce, at, this.balance.uppercutFlight, lift)
          if (lift && this.build.rank('uppercut')) enemy.landingWave = chain
          enemy.previousX = enemy.x
          enemy.previousZ = enemy.z
          enemy.previousY = enemy.y
          this.ai.advanceFlight(enemy, runner, now, dt * (1 - time), target => {
            if (target.landingWave) this.landings.push(target)
          })
        } else {
          // Live Bulldog keeps his AI's proposed movement and attack timing.
          const end = paths.get(enemy)!.end
          enemy.x = end.x
          enemy.z = end.z
          enemy.y = end.y
        }
        savePath(enemy, time, position)
      }
    }
    if (!state.hit && !state.missed && state.age + 1e-9 >= p.driveEnd && this.canStrike()) {
      state.missed = true
      this.emit('miss', runner.x, runner.z + p.reach)
    }
    this.clearBodyOverlap(runner, now)
  }

  sideStrike(runner: Runner, now: number, direction: -1 | 1) {
    if (!this.canStrike() || !runner.superHandsReady) return false
    const from = runner.lane
    if (!runner.changeLane(direction)) return false
    this.learnedActions.add('side')
    const first = this.laneTarget(runner, from, this.balance.reach)
    const second = this.balance.chainTargets > (first ? 1 : 0) ?
      this.laneTarget(runner, runner.lane, this.balance.reach) : undefined
    this.beginStrike(runner, now, direction < 0 ? 'sideLeft' : 'sideRight', second ?? first)
    if (!first && !second) return true
    const chain: Chain = { visited: new Set<number>() }
    if (first) chain.visited.add(first.id)
    if (second) chain.visited.add(second.id)
    this.audioCues.push('punch.hit')
    const strike = (enemy: Enemy) => {
      this.hit(enemy, this.baseDamage * this.balance.sideDamage, now, 'side')
      if (this.canDisplace(enemy)) this.impulse(enemy, chain, 0, direction * this.balance.sideImpulse,
        this.force * this.balance.sideForce, now, 0.60)
    }
    if (first) strike(first)
    if (second) strike(second)
    return true
  }

  tutorialCounter(runner: Runner, now: number, target: Enemy, skip = false) {
    if (target.type === 'bulldog' || !this.canStrike() || this.counterTarget(runner, now) !== target) return false
    if (skip) setPose(target, 'recovery', now, this.balance.enemies[target.type].recovery)
    else {
      this.lastTap = now
      this.counter(runner, now, target, false)
    }
    return true
  }

  clearInput() {
    this.pendingTap = undefined
    this.lastTap = -Infinity
  }

  private canStrike() { return this.hp > 0 && (!this.boss || this.boss.hp > 0) }
  private punchReady(now: number) { return now + 1e-9 >= this.nextPunch }
  private get baseDamage() { return this.balance.damage * this.build.damage }
  private get force() { return this.balance.knockback * this.build.knockback }
  private canDisplace(enemy: Enemy) { return enemy.type !== 'bulldog' || enemy.hp <= 0 }

  take(id: UpgradeId) {
    if (!this.build.take(id, this.hp, this.balance.hp)) return false
    if (id === 'breath') this.hp = Math.min(this.balance.hp, this.hp + 25)
    return true
  }

  update(runner: Runner, now: number, dt: number, invulnerable = false) {
    if (!this.canStrike()) return
    this.correctedX.clear()
    if (this.pendingTap !== undefined && this.punchReady(now)) {
      const at = this.pendingTap
      this.pendingTap = undefined
      if (runner.superHandsReady && now - at <= this.balance.inputBuffer + dt) this.punch(runner, now, this.build.acceleration)
    }
    if (!this.canStrike()) return

    const bossPose = this.boss?.pose
    this.landings.length = 0
    const attacks: Enemy[] = []
    const uppercutAttacks: { enemy: Enemy; at: number }[] = []
    this.ai.update(this.enemies, runner, now, dt, (enemy, at) => {
      if (runner.uppercutStep) uppercutAttacks.push({ enemy, at })
      else if (runner.superSweepTo > runner.superSweepFrom) attacks.push(enemy)
      else if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].damage, now, 'attack', runner)
    }, enemy => { if (enemy.landingWave) this.landings.push(enemy) })

    if (runner.uppercutStep && runner.uppercutSegments.length) {
      this.resolveUppercutStep(runner, now, dt, invulnerable, uppercutAttacks)
    }

    this.resolveContacts(runner, now, dt, invulnerable, true)
    if (!this.canStrike()) return
    this.dashPush.update(runner, this.enemies, now, dt, this.build.rank('wave') > 0, (enemy, point) => {
      this.audioCues.push('dash.impact')
      this.hit(enemy, this.baseDamage * this.balance.superDamage, now, 'dashImpact', undefined, point)
      this.dashElectric(runner, now, enemy, { visited: new Set([enemy.id]) })
    })
    if (!this.canStrike()) return
    for (const enemy of attacks) {
      const gap = enemy.z - runner.z
      if (!invulnerable && enemy.hp > 0 && gap > -0.4 &&
        (enemy.type === 'bulldog' ? gap <= 3.55 :
          !enemy.dashPushed && !this.dashPush.touched.has(enemy.id) && gap <= 2.65 && Math.abs(enemy.x - runner.x) < 0.84)) {
        this.hurt(enemy, this.balance.enemies[enemy.type].damage, now, 'attack', runner)
      }
    }

    const nextBossPose = this.boss?.pose
    if (nextBossPose !== bossPose) {
      if (nextBossPose === 'telegraph') this.audioCues.push('boss.windup')
      else if (nextBossPose === 'attack') this.audioCues.push('boss.attack')
      else if (nextBossPose === 'retreat') this.audioCues.push('boss.jump_back')
    }

    if (!this.canStrike()) return
    if (!runner.uppercutStep) this.resolveContacts(runner, now, dt, invulnerable)
    if (!this.canStrike()) return
    for (const enemy of this.landings) this.landWave(enemy, now)
    this.collisions(now, dt)
    if (this.boss && this.boss.hp <= 0) return
    let nearby = false
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      const flying = now < enemy.flightUntil || enemy.y > 0
      if (enemy.type !== 'bulldog' && !enemy.dashPushed && (now >= enemy.removeAt || (enemy.z < runner.z - 3.5 && !flying))) {
        this.enemies.splice(i, 1)
        continue
      }
      if (enemy.hp <= 0) continue
      if (enemy.z - runner.z < 12 && enemy.z >= runner.z - 0.5) nearby = true
      if (enemy.burnTicks && now >= enemy.burnAt) {
        enemy.burnAt += 0.30
        enemy.burnTicks--
        this.damage(enemy, enemy.burnDamage, now)
        if (this.boss && this.boss.hp <= 0) return
      }
    }
    if (this.combo > 0 && nearby) {
      this.comboLeft -= dt
      if (this.comboLeft <= 0) {
        this.combo--
        this.comboLeft = this.balance.comboDecay
      }
    }
  }

  private beginStrike(runner: Runner, now: number, kind: Strike['kind'], target?: Enemy) {
    const hand = kind === 'sideLeft' ? 'left' : kind === 'sideRight' ? 'right' : this.hand
    this.strike = { hand, kind, at: now, aim: target ? target.x - runner.x : 0, hit: !!target }
    if (kind === 'punch' || kind === 'counter') this.hand = this.hand === 'left' ? 'right' : 'left'
    if (!target) {
      this.audioCues.push('punch.miss')
      this.emit('miss', runner.x, runner.z + 1.8)
    }
  }

  private punch(runner: Runner, now: number, dash?: number) {
    const target = this.pickTarget(runner)
    this.nextPunch = now + this.punchInterval
    if (dash !== undefined) runner.launchDash(dash)
    this.learnedActions.add('punch')
    this.beginStrike(runner, now, 'punch', target)
    if (!target) return
    this.audioCues.push(target.type === 'brute' || target.type === 'bulldog' ? 'punch.heavy_hit' : 'punch.hit')
    const pushed = target.dashPushed
    this.hit(target, this.baseDamage, now, 'hit')
    if (!pushed && this.canDisplace(target)) this.impulse(target, { visited: new Set([target.id]) }, 0, 0, this.force, now, 0.66)
  }

  private counter(runner: Runner, now: number, target: Enemy, ideal: boolean) {
    this.pendingTap = undefined
    this.nextPunch = now + this.punchInterval
    runner.launchDash(this.build.acceleration)
    this.beginStrike(runner, now, 'counter', target)
    const points = ideal ? this.balance.idealScore : this.balance.counterScore
    this.counters++
    if (ideal) this.perfect++
    this.score += points
    this.audioCues.push(ideal ? 'counter.perfect' : 'counter.success')
    this.hit(target, this.baseDamage * (ideal ? this.balance.idealDamage : this.balance.counterDamage) *
      this.build.counterDamage, now, ideal ? 'ideal' : 'counter', points)
    this.impulse(target, { visited: new Set([target.id]) }, 0, 0, this.force * (ideal ? 1.48 : 1.24), now, 0.66)
    if (target.hp <= 0) return
    const boss = target.type === 'bulldog'
    if (boss) {
      this.audioCues.push('boss.stun')
      target.y = Math.max(0.03, target.y)
      target.vy = 3.4
    }
    setPose(target, 'stunned', now, (boss ? this.balance.counterStun : this.balance.regularCounterStun) + this.build.stunBonus)
  }

  private resolveContacts(runner: Runner, now: number, dt: number, invulnerable: boolean, preparationOnly = false) {
    const from = runner.superSweepFrom
    const to = runner.superSweepTo
    const driven = to > from
    if (preparationOnly && (!driven || from <= 0)) return
    const rx = runner.x - runner.previousX
    this.crossings.length = 0
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.dashPushed || this.dashPush.touched.has(enemy.id)) continue
      const gap = enemy.previousZ - runner.previousZ
      if (enemy.contactSide) {
        if (now < enemy.contactUntil || (gap >= -bodyBehind - 0.08 && gap <= bodyAhead + 0.08 &&
          Math.abs(enemy.previousX - runner.previousX) <= bodyWidth + 0.08 && enemy.previousY <= bodyHeight + 0.08)) continue
        enemy.contactSide = 0
      }
      if (enemy.type !== 'bulldog' && gap >= -bodyBehind && now >= enemy.contactUntil) {
        // Use the same start, driven, and end segments as the dash; the long step
        // that enters or exits the powered phase cannot put a body hit out of order.
        const body = (start: number, end: number, z0: number, z1: number) =>
          this.crossingTime(enemy, runner, start, end, z0, z1, bodyWidth, bodyAhead, bodyHeight)
        let time = driven && from > 0 ? body(0, from, runner.previousZ, runner.superSweepZFrom) : Infinity
        if (!preparationOnly && !Number.isFinite(time) && driven) time = body(from, to, runner.superSweepZFrom, runner.superSweepZTo)
        if (!preparationOnly && !Number.isFinite(time) && (!driven || to < 1)) time = driven ?
          body(to, 1, runner.superSweepZTo, runner.z) : body(0, 1, runner.previousZ, runner.z)
        if (Number.isFinite(time)) this.crossings.push({ enemy, time })
      }
    }
    this.crossings.sort((a, b) => a.time - b.time || a.enemy.id - b.enemy.id)
    for (const { enemy, time } of this.crossings) {
      if (!this.canStrike()) break
      if (enemy.hp <= 0 || enemy.contactSide) continue
      const x = enemy.previousX + (enemy.x - enemy.previousX) * time
      const z = enemy.previousZ + (enemy.z - enemy.previousZ) * time
      const heroX = runner.previousX + rx * time
      const direction = this.shoveSide(enemy, heroX, x)
      const flight = enemy.chain
      const alreadyFlying = now < enemy.flightUntil || enemy.y > 0
      const bodyChain = flight ?? { kind: 'body', visited: new Set([enemy.id]) } as const
      this.events.push({ kind: alreadyFlying ? 'bodyShove' : 'bodyContact', enemy: enemy.id, x, z, direction })
      if (!alreadyFlying) {
        this.audioCues.push('enemy.collision')
        if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].contact, now, 'contact', runner)
      }
      this.shove(enemy, bodyChain, flight ? enemy.depth : 0, { x, z, direction }, 8.4, 4.3, now, 0.38, dt * (1 - time))
    }
    this.clearBodyOverlap(runner, now)
  }

  private clearBodyOverlap(runner: Runner, now: number) {
    // A laterally flying enemy must be outside the player's body before the
    // camera crosses it, even if a fast frame leaves very little reaction time.
    for (const enemy of this.enemies) {
      if (!enemy.contactSide || enemy.type === 'bulldog' || now >= enemy.flightUntil || enemy.y > 1.10 ||
        enemy.z - runner.z > 0.12 || enemy.previousZ - runner.previousZ < -bodyBehind ||
        Math.abs(enemy.x - runner.x) >= bodyClearance) continue
      const side = this.shoveSide(enemy, runner.x, enemy.x, enemy.contactSide)
      this.correctedX.set(enemy.id, enemy.x)
      enemy.x = runner.x + side * bodyClearance
      enemy.vx = side * Math.abs(enemy.vx)
      enemy.contactSide = side
    }
  }

  private crossingTime(enemy: Enemy, runner: Runner, start: number, end: number, z0: number, z1: number,
    width: number, ahead: number, height: number) {
    const span = end - start
    const dx = enemy.x - enemy.previousX - (runner.x - runner.previousX)
    const dz = enemy.z - enemy.previousZ
    const dy = enemy.y - enemy.previousY
    const t = sweepBox(enemy.previousX - runner.previousX + dx * start,
      enemy.previousZ + dz * start - z0, enemy.previousY + dy * start,
      dx * span, dz * span - (z1 - z0), dy * span, width, bodyBehind, ahead, height)
    return start + t * span
  }

  private shoveSide(enemy: Enemy, heroX: number, enemyX: number, preferred: Side | 0 = 0): Side {
    const away: Side = preferred || (enemyX < heroX - 0.03 ? -1 : enemyX > heroX + 0.03 ? 1 : enemy.id % 2 ? -1 : 1)
    return Math.abs(heroX + away * bodyClearance) <= flightEdge ? away : away === 1 ? -1 : 1
  }

  private shove(enemy: Enemy, chain: Chain, depth: number, impact: Impact & { direction: Side },
    lateral: number, forward: number, now: number, duration: number, remaining: number) {
    enemy.x = impact.x
    enemy.z = impact.z
    enemy.contactUntil = now + 1.2
    enemy.contactSide = impact.direction
    this.impulse(enemy, chain, depth, impact.direction * lateral * this.balance.enemies[enemy.type].resistance,
      forward, now, duration)
    moveFlightPlanar(enemy, Math.min(duration, remaining))
  }

  private dashElectric(runner: Runner, now: number, target: Enemy, chain: Chain) {
    if (!this.build.rank('electric') || chain.visited.size >= this.balance.chainTargets) return
    let neighbor: Enemy | undefined
    let distance = this.balance.electricRadius
    for (const enemy of this.enemies) {
      const gap = Math.hypot(enemy.x - target.x, enemy.z - target.z)
      if (enemy.hp > 0 && !chain.visited.has(enemy.id) && enemy.z >= runner.z - 0.28 && gap < distance) {
        neighbor = enemy
        distance = gap
      }
    }
    if (neighbor) {
      chain.visited.add(neighbor.id)
      this.audioCues.push('upgrade.electric')
      this.emit('electric', neighbor.x, neighbor.z, neighbor.id, target.x, target.z)
      this.hit(neighbor, this.baseDamage * this.balance.electricDamage, now, 'hit')
      if (this.canDisplace(neighbor)) this.impulse(neighbor, chain, 0, 0, this.force * 0.56, now, 0.50)
    }
  }

  private landWave(source: Enemy, now: number) {
    const chain = source.landingWave
    source.landingWave = undefined
    if (!chain) return
    this.audioCues.push('upgrade.shockwave')
    this.emit('landing', source.x, source.z)
    for (const enemy of this.enemies) {
      if (chain.visited.size >= this.balance.chainTargets) break
      if (enemy.hp <= 0 || enemy.y > 0.81 || chain.visited.has(enemy.id) ||
        Math.hypot(enemy.x - source.x, enemy.z - source.z) > this.balance.landingRadius) continue
      chain.visited.add(enemy.id)
      this.hit(enemy, this.baseDamage * this.balance.landingDamage, now, 'hit')
      if (this.canDisplace(enemy)) this.impulse(enemy, chain, 0, Math.sign(enemy.x - source.x) * 3.4,
        this.force * 0.56, now, 0.50)
    }
  }

  private laneTarget(runner: Runner, lane: Lane, reach: number, grounded = false) {
    let target: Enemy | undefined
    let best = Infinity
    for (const enemy of this.enemies) {
      const distance = enemy.z - runner.z
      if (enemy.hp <= 0 || distance < -0.28 || distance > reach || laneAt(enemy.x) !== lane ||
        enemy.y > (grounded ? 0.05 : 1.25) || (grounded && (enemy.pose === 'airborne' || enemy.landingWave))) continue
      const priority = distance + Math.abs(enemy.x - laneX(lane)) * 0.2
      if (priority < best) { target = enemy; best = priority }
    }
    return target
  }

  private pickTarget(runner: Runner) {
    let target: Enemy | undefined
    let best = Infinity
    for (const enemy of this.enemies) {
      const distance = enemy.z - runner.z
      const offset = Math.abs(enemy.x - runner.x)
      const width = enemy.type === 'bulldog' ? 1.42 : 0.75
      if (enemy.hp <= 0 || distance < -0.28 || distance > this.balance.reach || offset > width || enemy.y > 1.25) continue
      const priority = distance + offset * 0.9
      if (priority < best) { target = enemy; best = priority }
    }
    return target
  }

  private hit(enemy: Enemy, damage: number, now: number, kind: Effect, points?: number, impact?: Impact) {
    const multiplier = this.multiplier
    this.combo++
    if (this.multiplier > multiplier) this.audioCues.push('combo.milestone')
    this.comboLeft = this.balance.comboGrace
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.events.push({ kind, x: enemy.x, z: enemy.z, ...impact, enemy: enemy.id, points })
    this.damage(enemy, damage, now)
    const fire = this.build.rank('fire')
    if (fire && enemy.hp > 0) {
      if (!enemy.burnTicks) {
        this.audioCues.push('upgrade.fire')
        enemy.burnAt = now + 0.30
        this.emit('fire', enemy.x, enemy.z, enemy.id)
      }
      enemy.burnTicks = 4
      enemy.burnDamage = this.balance.damage * (0.10 + 0.055 * (fire - 1))
    }
  }

  private damage(enemy: Enemy, amount: number, now: number) {
    if (enemy.hp <= 0) return
    enemy.hp = Math.max(0, enemy.hp - amount)
    if (enemy.hp > 0) {
      if (enemy.type === 'bulldog' && enemy.bossPhase === 1 && enemy.hp <= enemy.maxHp / 2) {
        enemy.bossPhase = 2
        this.emit('rage', enemy.x, enemy.z, enemy.id)
        if (enemy.pose !== 'telegraph' && enemy.pose !== 'attack' && enemy.pose !== 'stunned') setPose(enemy, 'rage', now, 0.44)
      }
      return
    }
    if (enemy.type !== 'bulldog') this.audioCues.push('enemy.fall')
    this.dashPush.detach(enemy)
    enemy.removeAt = now + 1.24
    enemy.burnTicks = 0
    setPose(enemy, 'fall', now, 0.26)
    this.kills++
    const stats = this.balance.enemies[enemy.type]
    this.xp += stats.xp
    this.score += enemy.type === 'bulldog' ? stats.score : Math.round(stats.score * this.multiplier)
  }

  private impulse(enemy: Enemy, chain: Chain | undefined, depth: number, vx: number, vz: number, now: number,
    length: number, lift = 0) {
    this.dashPush.detach(enemy)
    enemy.chain = chain
    enemy.depth = depth
    enemy.vx = vx
    const speed = vz * this.balance.enemies[enemy.type].resistance
    enemy.vz = chain?.kind === 'uppercut' ? Math.min(this.balance.uppercutMaxSpeed, speed) : speed
    enemy.flightUntil = now + length
    if (lift) {
      enemy.y = Math.max(0.04, enemy.y)
      enemy.vy = lift
    }
    setPose(enemy, lift ? 'airborne' : enemy.hp <= 0 ? 'fall' : Math.abs(vx) > 3 ? 'sideFlight' : 'knockback', now, length)
  }

  private collisions(now: number, dt: number) {
    for (const source of this.enemies) {
      const chain = source.chain
      if (!chain || source.depth >= (chain.kind === 'uppercut' ? this.balance.uppercutChainDepth : this.balance.chainDepth) ||
        chain.visited.size >= this.balance.chainTargets ||
        source.since >= now || now >= source.flightUntil) continue
      const body = chain.kind === 'body'
      const heavy = chain.kind === 'uppercut'
      const flightStart = heavy && dt > 0 ? Math.max(0, Math.min(1, (source.since - (now - dt)) / dt)) : 0
      const sourceX = this.correctedX.get(source.id) ?? source.x
      let hit: Enemy | undefined
      let earliest = Infinity
      let bend: Enemy | undefined
      let nearest = 5.5
      for (const target of this.enemies) {
        if (target.hp <= 0 || chain.visited.has(target.id) ||
          (body ? target.type === 'bulldog' : target.z < source.previousZ - 0.35)) continue
        const targetX = target.previousX + (target.x - target.previousX) * flightStart
        const targetZ = target.previousZ + (target.z - target.previousZ) * flightStart
        const targetY = target.previousY + (target.y - target.previousY) * flightStart
        const dx = source.previousX - targetX
        const dz = source.previousZ - targetZ
        const endX = sourceX - (this.correctedX.get(target.id) ?? target.x)
        const endZ = source.z - target.z
        const vx = endX - dx
        const vz = endZ - dz
        const speedSq = vx * vx + vz * vz
        let t = speedSq > 0 ? Math.max(0, Math.min(1, -(dx * vx + dz * vz) / speedSq)) : 0
        const radius = target.type === 'bulldog' ? 0.90 : 0.68
        if (heavy || body) {
          const y = source.previousY - targetY
          t = sweepBodies(dx, dz, y, vx, vz, source.y - target.y - y, radius, body ? 0.8 : 1.10)
        }
        if (t < earliest && (heavy || body || (Math.abs(source.y - target.y) < 0.81 &&
          (dx + vx * t) ** 2 + (dz + vz * t) ** 2 <= radius ** 2))) {
          earliest = t
          hit = target
        }
        const distance = target.z - source.z
        const lateral = Math.abs(endX)
        if (distance > 0.5 && distance < nearest && lateral > 0.45 && lateral < 2.35) {
          bend = target
          nearest = distance
        }
      }
      if (!hit) {
        if (!body && bend && this.build.rank('ricochet')) {
          const goal = Math.max(-12, Math.min(12, (bend.x - source.x) / Math.max(0.10, nearest / Math.max(5, source.vz))))
          source.vx += (goal - source.vx) * 0.43
          source.vz *= 0.96
        }
        continue
      }
      chain.visited.add(hit.id)
      if (body) {
        const direction = source.vx < 0 ? -1 : 1
        this.events.push({ kind: 'bodyShove', enemy: hit.id, x: hit.x, z: hit.z, direction })
        const carried = hit.chain
        const keepAttack = carried && carried.kind !== 'body'
        this.impulse(hit, keepAttack ? carried : chain, keepAttack ? hit.depth : source.depth + 1,
          direction * Math.max(3.2, Math.abs(source.vx) * 0.72) * this.balance.enemies[hit.type].resistance,
          Math.max(1.5, source.vz * 0.66), now, 0.32)
        source.vz *= 0.67
        continue
      }
      this.audioCues.push(heavy ? 'uppercut.ricochet' : 'enemy.collision')
      this.score += 25
      this.hit(hit, this.balance.damage * this.balance.chainDamage * this.build.chainDamage, now, heavy ? 'ricochet' : 'chain')
      if (hit.type !== 'bulldog' || hit.hp <= 0) {
        this.impulse(hit, chain, source.depth + 1, source.vx * 0.62,
          Math.max(8, source.vz * (heavy ? this.balance.uppercutTransfer : 0.89)), now, heavy ? this.balance.uppercutFlight : 0.58)
      }
      source.vz *= 0.67
    }
  }

  private hurt(enemy: Enemy, amount: number, now: number, cause: string, runner: Runner) {
    if (now < this.invulnerableUntil || this.hp <= 0 || amount <= 0) return
    const damage = Math.min(this.hp, amount)
    this.hp -= damage
    this.damageTaken += damage
    this.damageCause = enemy.type === 'bulldog' ? 'Удар Бульдога' : cause === 'contact' ? 'Столкновение с врагом' : 'Удар противника'
    this.invulnerableUntil = now + this.balance.immunity
    this.combo = 0
    this.holdBlockedUntil = now + this.balance.holdHurtPause
    this.audioCues.push('player.hurt')
    this.emit('hurt', runner.x, runner.z + 0.4)
  }

  finish(runner: Runner, now: number) {
    const boss = this.boss
    if (!boss) return
    this.strike = { hand: this.hand, kind: 'finish', at: now, aim: boss.x - runner.x, hit: true }
    boss.x = Math.max(-route.laneWidth, Math.min(route.laneWidth, boss.x))
    setPose(boss, 'finish', now)
    this.emit('finish', boss.x, boss.z, boss.id)
    this.score += 500 + Math.round(this.hp * 10) + (this.damageTaken === 0 ? 500 : 0)
  }

  private emit(kind: Effect, x: number, z: number, enemy?: number, fromX?: number, fromZ?: number) {
    this.events.push({ kind, x, z, enemy, fromX, fromZ })
  }
}

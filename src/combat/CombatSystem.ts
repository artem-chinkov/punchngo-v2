import type { EnemyType, Hand } from '../assets/ids'
import type { SfxCue } from '../audio/cues'
import type { Runner } from '../game/Runner'
import { Build, type UpgradeId } from '../game/upgrades'
import { laneAt, laneX, route, type Lane } from '../world/route'
import { createEnemy, EnemyAI, flightEdge, inCounterWindow, moveFlightPlanar, setPose, type Chain, type Enemy } from './EnemyAI'
import { superTiming, uppercutTiming, type Balance } from './balance'
import { sweepBodies, sweepBox } from './sweep'

export type Effect = 'hit' | 'dashImpact' | 'ricochet' | 'counter' | 'ideal' | 'chain' | 'air' | 'wave' | 'electric' |
  'fire' | 'hurt' | 'miss' | 'rage' | 'finish' | 'level' | 'side' | 'landing' | 'bodyContact' | 'bodyShove'
type Side = -1 | 1
type Impact = { x: number; z: number; direction?: Side }
type Crossing = { enemy: Enemy; time: number; dash: boolean }
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
  private uppercutImpact = Infinity
  private superChain?: Chain
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
    if (!this.canStrike() || this.pendingTap !== undefined || !this.punchReady(now) ||
      now < this.holdBlockedUntil) return false
    this.punch(runner, now, dash ? 1 : undefined)
    return true
  }

  special(runner: Runner, now: number, kind: Special) {
    if (!this.canStrike() || this.specialRemaining(now) > 1e-9) return false
    if (kind === 'superDash') {
      if (!runner.launchSuper()) return false
      this.specialDuration = superTiming(this.balance).duration + this.balance.superRecovery
      this.superChain = { kind, visited: new Set(), limit: this.balance.superTargets }
      this.audioCues.push('dash.start')
      if (this.build.rank('wave')) this.audioCues.push('upgrade.shockwave')
    } else {
      const timing = uppercutTiming(this.balance)
      this.specialDuration = Math.max(timing.duration, this.balance.specialCooldown)
      this.uppercutStrike = this.strike = { hand: this.uppercutHand, kind, at: now, aim: 0, hit: false }
      this.uppercutHand = this.uppercutHand === 'left' ? 'right' : 'left'
      this.uppercutImpact = now + timing.windup
      this.audioCues.push('uppercut.windup')
    }
    this.nextSpecial = now + this.specialDuration
    this.learnedActions.add(kind)
    return true
  }

  private resolveUppercut(runner: Runner, now: number) {
    this.uppercutImpact = Infinity
    const strike = this.uppercutStrike
    const target = this.laneTarget(runner, laneAt(runner.x), this.balance.reach, true)
    if (!strike || !target) {
      this.emit('miss', runner.x, runner.z + 1.8)
      return
    }
    strike.aim = target.x - runner.x
    strike.hit = true
    const chain: Chain = { kind: 'uppercut', visited: new Set([target.id]) }
    this.audioCues.push('uppercut.impact')
    this.hit(target, this.baseDamage * this.balance.uppercutDamage, now, 'air')
    if (!this.canDisplace(target)) return
    const lift = target.type === 'bulldog' ? 0 : this.balance.uppercutLift
    this.impulse(target, chain, 0, 0, this.force * this.balance.uppercutForce, now, this.balance.uppercutFlight, lift)
    if (lift && this.build.rank('uppercut')) target.landingWave = chain
  }

  sideStrike(runner: Runner, now: number, direction: -1 | 1) {
    if (!this.canStrike()) return false
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
    if (now + 1e-9 >= this.uppercutImpact) this.resolveUppercut(runner, now)
    if (!this.canStrike()) return
    if (this.pendingTap !== undefined && this.punchReady(now)) {
      const at = this.pendingTap
      this.pendingTap = undefined
      if (now - at <= this.balance.inputBuffer + dt) this.punch(runner, now, this.build.acceleration)
    }
    if (!this.canStrike()) return

    const bossPose = this.boss?.pose
    this.landings.length = 0
    this.ai.update(this.enemies, runner, now, dt, enemy => {
      if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].damage, now, 'attack', runner)
    }, enemy => { if (enemy.landingWave) this.landings.push(enemy) })

    const nextBossPose = this.boss?.pose
    if (nextBossPose !== bossPose) {
      if (nextBossPose === 'telegraph') this.audioCues.push('boss.windup')
      else if (nextBossPose === 'attack') this.audioCues.push('boss.attack')
      else if (nextBossPose === 'retreat') this.audioCues.push('boss.jump_back')
    }

    if (!this.canStrike()) return
    this.resolveContacts(runner, now, dt, invulnerable)
    if (!this.canStrike()) return
    for (const enemy of this.landings) this.landWave(enemy, now)
    this.collisions(now)
    if (this.boss && this.boss.hp <= 0) return
    let nearby = false
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      const flying = now < enemy.flightUntil || enemy.y > 0
      if (enemy.type !== 'bulldog' && (now >= enemy.removeAt || (enemy.z < runner.z - 3.5 && !flying))) {
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
    this.hit(target, this.baseDamage, now, 'hit')
    if (this.canDisplace(target)) this.impulse(target, { visited: new Set([target.id]) }, 0, 0, this.force, now, 0.66)
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

  private resolveContacts(runner: Runner, now: number, dt: number, invulnerable: boolean) {
    const chain = this.superChain
    const from = runner.superSweepFrom
    const to = runner.superSweepTo
    const driven = to > from
    const canDash = driven && chain && chain.visited.size < this.chainLimit(chain)
    const rx = runner.x - runner.previousX
    const wave = this.build.rank('wave') > 0
    this.crossings.length = 0
    this.correctedX.clear()
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue
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
        if (!Number.isFinite(time) && driven) time = body(from, to, runner.superSweepZFrom, runner.superSweepZTo)
        if (!Number.isFinite(time) && (!driven || to < 1)) time = driven ?
          body(to, 1, runner.superSweepZTo, runner.z) : body(0, 1, runner.previousZ, runner.z)
        if (Number.isFinite(time)) this.crossings.push({ enemy, time, dash: false })
      }
      if (canDash && !chain.visited.has(enemy.id)) {
        const time = this.crossingTime(enemy, runner, from, to, runner.superSweepZFrom, runner.superSweepZTo,
          wave ? route.laneWidth + 0.72 : 0.72, wave ? 1.45 : 1.12, 1.10)
        if (Number.isFinite(time) && (!wave ||
          Math.abs(laneAt(enemy.previousX + (enemy.x - enemy.previousX) * time) - laneAt(runner.previousX + rx * time)) <= 1)) {
          this.crossings.push({ enemy, time, dash: true })
        }
      }
    }
    this.crossings.sort((a, b) => a.time - b.time || Number(b.dash) - Number(a.dash) || a.enemy.id - b.enemy.id)
    for (const { enemy, time, dash } of this.crossings) {
      if (!this.canStrike()) break
      if (enemy.hp <= 0 || enemy.contactSide) continue
      const x = enemy.previousX + (enemy.x - enemy.previousX) * time
      const z = enemy.previousZ + (enemy.z - enemy.previousZ) * time
      const heroX = runner.previousX + rx * time
      const direction = this.shoveSide(enemy, heroX, x)
      if (dash) {
        if (!chain || chain.visited.has(enemy.id) || chain.visited.size >= this.chainLimit(chain)) continue
        const first = chain.visited.size === 0
        chain.visited.add(enemy.id)
        this.audioCues.push('dash.impact')
        this.hit(enemy, this.baseDamage * this.balance.superDamage, now, 'dashImpact', undefined, { x, z, direction })
        if (this.canDisplace(enemy)) this.shove(enemy, chain, 0, { x, z, direction },
          this.balance.superPush * 1.30 * this.build.knockback, this.force * 0.48, now, 0.44, dt * (1 - time))
        if (first) this.dashElectric(runner, now, enemy, chain)
      } else {
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
    }
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

  private chainLimit(chain: Chain) {
    return Math.min(this.balance.chainTargets, chain.limit ?? this.balance.chainTargets)
  }

  private dashElectric(runner: Runner, now: number, target: Enemy, chain: Chain) {
    if (!this.build.rank('electric') || chain.visited.size >= this.chainLimit(chain)) return
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
      if (chain.visited.size >= this.chainLimit(chain)) break
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

  private collisions(now: number) {
    for (const source of this.enemies) {
      const chain = source.chain
      if (!chain || source.depth >= (chain.kind === 'uppercut' ? this.balance.uppercutChainDepth : this.balance.chainDepth) ||
        chain.visited.size >= this.chainLimit(chain) ||
        source.since >= now || now >= source.flightUntil) continue
      const body = chain.kind === 'body'
      const heavy = chain.kind === 'uppercut'
      const sourceX = this.correctedX.get(source.id) ?? source.x
      let hit: Enemy | undefined
      let earliest = Infinity
      let bend: Enemy | undefined
      let nearest = 5.5
      for (const target of this.enemies) {
        if (target.hp <= 0 || chain.visited.has(target.id) ||
          (body ? target.type === 'bulldog' : target.z < source.previousZ - 0.35)) continue
        const dx = source.previousX - target.previousX
        const dz = source.previousZ - target.previousZ
        const endX = sourceX - (this.correctedX.get(target.id) ?? target.x)
        const endZ = source.z - target.z
        const vx = endX - dx
        const vz = endZ - dz
        const speedSq = vx * vx + vz * vz
        let t = speedSq > 0 ? Math.max(0, Math.min(1, -(dx * vx + dz * vz) / speedSq)) : 0
        const radius = target.type === 'bulldog' ? 0.90 : 0.68
        if (heavy || body) {
          const y = source.previousY - target.previousY
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

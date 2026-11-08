import type { EnemyType, Hand } from '../assets/ids'
import type { SfxCue } from '../audio/cues'
import type { Runner } from '../game/Runner'
import { Build, type UpgradeId } from '../game/upgrades'
import { laneAt, laneX, route, lanes, type Lane } from '../world/route'
import { createEnemy, EnemyAI, inCounterWindow, setPose, type Chain, type Enemy } from './EnemyAI'
import type { Balance } from './balance'

export type Effect = 'hit' | 'hook' | 'counter' | 'ideal' | 'chain' | 'air' | 'wave' | 'electric' |
  'fire' | 'hurt' | 'miss' | 'rage' | 'finish' | 'level' | 'side' | 'landing'
export interface CombatEvent {
  kind: Effect
  x: number
  z: number
  enemy?: number
  fromX?: number
  fromZ?: number
  points?: number
}
export interface Strike {
  hand: Hand
  kind: 'punch' | 'hook' | 'uppercut' | 'sideLeft' | 'sideRight' | 'counter' | 'finish'
  at: number
  aim: number
  hit: boolean
}
type Special = 'hook' | 'uppercut'

export class CombatSystem {
  readonly enemies: Enemy[] = []
  readonly events: CombatEvent[] = []
  readonly audioCues: SfxCue[] = []
  readonly build = new Build()
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
  boss?: Enemy
  private readonly ai: EnemyAI
  private nextId = 1
  private hand: Hand = 'left'
  private nextPunch = 0
  private lastTap = -Infinity
  private pendingTap?: number
  private nextSpecial = 0
  private holdBlockedUntil = 0
  private readonly landings: Enemy[] = []
  private comboLeft = 0

  constructor(readonly balance: Balance) {
    this.hp = balance.hp
    this.ai = new EnemyAI(balance)
  }

  get multiplier() { return this.combo >= 25 ? 3 : this.combo >= 12 ? 2 : this.combo >= 5 ? 1.5 : 1 }
  get punchInterval() { return Math.max(this.balance.minPunchInterval, this.balance.punchInterval / this.build.attackRate) }

  specialRemaining(now: number) { return Math.max(0, this.nextSpecial - now) }

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
    this.nextSpecial = now + this.balance.specialCooldown
    const lane = laneAt(runner.x)
    const target = this.laneTarget(runner, lane, this.balance.reach + (kind === 'hook' ? 0.28 : 0),
      kind === 'uppercut')
    this.beginStrike(runner, now, kind, target)
    if (!target) return true

    const chain: Chain = { visited: new Set([target.id]) }
    if (kind === 'uppercut') {
      this.audioCues.push('upgrade.uppercut')
      this.hit(target, this.baseDamage * this.balance.uppercutDamage, now, 'air')
      if (this.canDisplace(target)) {
        const lift = target.type === 'bulldog' ? 0 : this.balance.uppercutLift
        this.impulse(target, chain, 0, 0, this.force * this.balance.uppercutForce, now, 0.66, lift)
        if (lift && this.build.rank('uppercut')) target.landingWave = chain
      }
    } else {
      this.audioCues.push('punch.hook')
      this.hit(target, this.baseDamage * this.balance.hookDamage, now, 'hook')
      if (this.canDisplace(target)) {
        this.impulse(target, chain, 0, Math.sign(target.x - runner.x) * 2.8,
          this.force * this.balance.hookForce, now, 0.66)
      }
      this.hookExtras(runner, now, lane, target, chain)
    }
    return true
  }

  sideStrike(runner: Runner, now: number, direction: -1 | 1) {
    if (!this.canStrike()) return false
    const from = runner.lane
    if (!runner.changeLane(direction)) return false
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
    }, enemy => {
      if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].contact, now, 'contact', runner)
      enemy.contactUntil = now + 1.2
      const side = Math.sign(enemy.x - runner.x) || (enemy.id % 2 ? 1 : -1)
      this.impulse(enemy, undefined, 0, side * 5.5, 4.3, now, 0.32)
    }, enemy => { if (enemy.landingWave) this.landings.push(enemy) })

    const nextBossPose = this.boss?.pose
    if (nextBossPose !== bossPose) {
      if (nextBossPose === 'telegraph') this.audioCues.push('boss.windup')
      else if (nextBossPose === 'attack') this.audioCues.push('boss.attack')
      else if (nextBossPose === 'retreat') this.audioCues.push('boss.jump_back')
    }

    if (!this.canStrike()) return
    for (const enemy of this.landings) this.landWave(enemy, now)
    this.collisions(now)
    if (this.boss && this.boss.hp <= 0) return
    let nearby = false
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]
      if (enemy.type !== 'bulldog' && (enemy.z < runner.z - 3.5 || now >= enemy.removeAt)) {
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

  private hookExtras(runner: Runner, now: number, lane: Lane, target: Enemy, chain: Chain) {
    const wave = this.build.rank('wave') > 0
    if (wave) {
      this.audioCues.push('upgrade.shockwave')
      this.emit('wave', runner.x, target.z)
    }
    const depth = wave ? this.balance.hookWaveDepth : this.balance.hookSplashDepth
    const apply = (enemy: Enemy) => {
      if (chain.visited.size >= this.balance.chainTargets) return
      chain.visited.add(enemy.id)
      const side = Math.sign(enemy.x - target.x) || (enemy.id % 2 ? -1 : 1)
      this.hit(enemy, this.baseDamage * (wave ? this.balance.hookWaveDamage : this.balance.hookSplashDamage),
        now, wave ? 'wave' : 'hook')
      if (this.canDisplace(enemy)) this.impulse(enemy, chain, 0, side * 6.2, this.force * 0.91, now, 0.60)
    }
    let splash: Enemy | undefined
    for (const otherLane of lanes) {
      if (otherLane === lane || (!wave && Math.abs(otherLane - lane) !== 1)) continue
      let nearest: Enemy | undefined
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || chain.visited.has(enemy.id) || enemy.y > 1.25 || laneAt(enemy.x) !== otherLane ||
          enemy.z < runner.z - 0.28 || Math.abs(enemy.z - target.z) > depth) continue
        if (!nearest || enemy.z < nearest.z) nearest = enemy
      }
      if (nearest && wave) apply(nearest)
      else if (nearest && (!splash || nearest.z < splash.z)) splash = nearest
    }
    if (splash) apply(splash)
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

  private hit(enemy: Enemy, damage: number, now: number, kind: Effect, points?: number) {
    const multiplier = this.multiplier
    this.combo++
    if (this.multiplier > multiplier) this.audioCues.push('combo.milestone')
    this.comboLeft = this.balance.comboGrace
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.events.push({ kind, x: enemy.x, z: enemy.z, enemy: enemy.id, points })
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
    enemy.vz = vz * this.balance.enemies[enemy.type].resistance
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
      if (!chain || source.depth >= this.balance.chainDepth || chain.visited.size >= this.balance.chainTargets ||
        source.since >= now || now >= source.flightUntil) continue
      let hit: Enemy | undefined
      let earliest = Infinity
      let bend: Enemy | undefined
      let nearest = 5.5
      for (const target of this.enemies) {
        if (target.hp <= 0 || chain.visited.has(target.id) || target.z < source.previousZ - 0.35) continue
        const dx = source.previousX - target.previousX
        const dz = source.previousZ - target.previousZ
        const endX = source.x - target.x
        const endZ = source.z - target.z
        const vx = endX - dx
        const vz = endZ - dz
        const speedSq = vx * vx + vz * vz
        const t = speedSq > 0 ? Math.max(0, Math.min(1, -(dx * vx + dz * vz) / speedSq)) : 0
        const radius = target.type === 'bulldog' ? 0.90 : 0.68
        if (t < earliest && Math.abs(source.y - target.y) < 0.81 &&
          (dx + vx * t) ** 2 + (dz + vz * t) ** 2 <= radius ** 2) {
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
        if (bend && this.build.rank('ricochet')) {
          const goal = Math.max(-12, Math.min(12, (bend.x - source.x) / Math.max(0.10, nearest / Math.max(5, source.vz))))
          source.vx += (goal - source.vx) * 0.43
          source.vz *= 0.96
        }
        continue
      }
      chain.visited.add(hit.id)
      this.audioCues.push('enemy.collision')
      this.score += 25
      this.hit(hit, this.balance.damage * this.balance.chainDamage * this.build.chainDamage, now, 'chain')
      if (hit.type !== 'bulldog' || hit.hp <= 0) {
        this.impulse(hit, chain, source.depth + 1, source.vx * 0.62,
          Math.max(8, source.vz * 0.89), now, 0.58)
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

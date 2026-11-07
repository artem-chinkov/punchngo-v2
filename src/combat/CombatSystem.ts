import type { EnemyType, Hand } from '../assets/ids'
import type { Runner } from '../game/Runner'
import { Build, type UpgradeId } from '../game/upgrades'
import { route, type Lane } from '../world/route'
import { createEnemy, EnemyAI, inCounterWindow, setPose, type Chain, type Enemy } from './EnemyAI'
import type { Balance } from './balance'

export type Effect = 'hit' | 'hook' | 'counter' | 'ideal' | 'chain' | 'air' | 'wave' | 'electric' |
  'fire' | 'hurt' | 'miss' | 'rage' | 'finish' | 'level'
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
  kind: 'punch' | 'hook' | 'counter' | 'finish'
  at: number
  aim: number
  hit: boolean
}
interface Intent { at: number; counter?: Enemy; ideal: boolean }

export class CombatSystem {
  readonly enemies: Enemy[] = []
  readonly events: CombatEvent[] = []
  readonly build = new Build()
  hp: number
  xp = 0
  score = 0
  kills = 0
  combo = 0
  short = 0
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
  private pending?: Intent
  private directHits = 0
  private comboLeft = 0

  constructor(readonly balance: Balance) {
    this.hp = balance.hp
    this.ai = new EnemyAI(balance)
  }

  get multiplier() { return this.combo >= 25 ? 3 : this.combo >= 12 ? 2 : this.combo >= 5 ? 1.5 : 1 }
  get punchInterval() { return this.balance.punchInterval / this.build.attackRate }

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
    if (this.hp <= 0) return false
    const counter = this.counterTarget(runner, now)
    const intent = { at: now, counter, ideal: !!counter && counter.until - now <= this.balance.idealWindow &&
      now - this.lastTap >= this.punchInterval * this.balance.idealTapGap }
    this.lastTap = now
    if (now >= this.nextPunch) {
      this.pending = undefined
      this.attack(runner, now, intent)
      return true
    }
    if (this.nextPunch - now <= this.balance.inputBuffer && (!this.pending?.counter || counter)) this.pending = intent
    return false
  }

  clearInput() {
    this.pending = undefined
    this.lastTap = -Infinity
  }

  take(id: UpgradeId) {
    if (!this.build.take(id, this.hp, this.balance.hp)) return false
    if (id === 'breath') this.hp = Math.min(this.balance.hp, this.hp + 25)
    return true
  }

  update(runner: Runner, now: number, dt: number, invulnerable = false) {
    if (this.pending && now >= this.nextPunch) {
      const intent = this.pending
      this.pending = undefined
      if (now - intent.at <= this.balance.inputBuffer + dt) this.attack(runner, now, intent)
    }
    if (this.hp <= 0 || (this.boss && this.boss.hp <= 0)) return

    this.ai.update(this.enemies, runner, now, dt, enemy => {
      if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].damage, now, 'attack', runner)
    }, enemy => {
      if (!invulnerable) this.hurt(enemy, this.balance.enemies[enemy.type].contact, now, 'contact', runner)
      enemy.contactUntil = now + 1.2
      const side = Math.sign(enemy.x - runner.x) || (enemy.id % 2 ? 1 : -1)
      this.impulse(enemy, undefined, 0, side * 5.5, 4.3, now, 0.32)
    })

    if (this.hp <= 0) return
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

  private attack(runner: Runner, now: number, intent: Intent) {
    const counter = intent.counter && intent.counter === this.counterTarget(runner, now) ? intent.counter : undefined
    const hook = this.short === 2
    const target = counter ?? this.pickTarget(runner, hook)
    this.nextPunch = now + this.punchInterval
    runner.launchDash(this.build.acceleration)
    this.strike = { hand: this.hand, kind: counter ? 'counter' : hook ? 'hook' : 'punch',
      at: now, aim: target ? target.x - runner.x : 0, hit: !!target }
    this.hand = this.hand === 'left' ? 'right' : 'left'

    if (!target) {
      this.short = 0
      this.emit('miss', runner.x, runner.z + 1.8)
      return
    }

    this.short = hook ? 0 : this.short + 1
    this.directHits++
    const chain: Chain = { visited: new Set([target.id]) }
    const base = this.balance.damage * this.build.damage
    const ideal = !!counter && intent.ideal
    const factor = counter ? (ideal ? this.balance.idealDamage : this.balance.counterDamage) * this.build.counterDamage : 1
    const force = this.balance.knockback * this.build.knockback
    const uppercut = this.build.rank('uppercut') > 0 && this.directHits % 5 === 0
    const kind = counter ? (ideal ? 'ideal' : 'counter') : uppercut ? 'air' : hook ? 'hook' : 'hit'
    const points = ideal ? this.balance.idealScore : counter ? this.balance.counterScore : undefined
    if (points !== undefined) {
      this.counters++
      if (ideal) this.perfect++
      this.score += points
    }

    this.hit(target, base * (hook ? 1.5 : 1) * factor, now, kind, points)
    if (target.type !== 'bulldog' || counter || target.hp <= 0) {
      this.impulse(target, chain, 0, hook ? Math.sign(target.x - runner.x) * 2.8 : 0,
        force * (hook ? 1.33 : 1) * (counter ? (ideal ? 1.48 : 1.24) : 1), now, 0.66, uppercut)
      if (counter && target.hp > 0) {
        const stun = (target.type === 'bulldog' ? this.balance.counterStun : this.balance.regularCounterStun) + this.build.stunBonus
        if (target.type === 'bulldog' && !uppercut) {
          target.y = Math.max(0.03, target.y)
          target.vy = 3.4
        }
        setPose(target, 'stunned', now, stun)
      }
    }

    if (!hook) return
    const wave = this.build.rank('wave') > 0
    if (wave) this.emit('wave', runner.x, target.z)
    const width = wave ? 2.05 : 1.66
    for (const enemy of this.enemies) {
      if (chain.visited.size >= this.balance.chainTargets) break
      if (enemy.hp <= 0 || chain.visited.has(enemy.id) || enemy.z < runner.z - 0.3 ||
        Math.abs(enemy.z - target.z) > (wave ? 2.0 : 1.0) || Math.abs(enemy.x - runner.x) > width) continue
      chain.visited.add(enemy.id)
      const side = Math.sign(enemy.x - target.x) || (enemy.id % 2 ? -1 : 1)
      this.hit(enemy, base * (wave ? 0.61 : 0.42), now, wave ? 'wave' : 'hook')
      if (enemy.type !== 'bulldog' || enemy.hp <= 0) this.impulse(enemy, chain, 0, side * 6.2, force * 0.91, now, 0.60)
    }
    if (this.build.rank('electric') && chain.visited.size < this.balance.chainTargets) {
      let neighbor: Enemy | undefined
      let distance = 3.9
      for (const enemy of this.enemies) {
        const gap = Math.hypot(enemy.x - target.x, enemy.z - target.z)
        if (enemy.hp > 0 && !chain.visited.has(enemy.id) && enemy.z >= runner.z - 0.3 && gap < distance) {
          neighbor = enemy
          distance = gap
        }
      }
      if (neighbor) {
        chain.visited.add(neighbor.id)
        this.emit('electric', neighbor.x, neighbor.z, neighbor.id, target.x, target.z)
        this.hit(neighbor, base * 0.55, now, 'hit')
        if (neighbor.type !== 'bulldog' || neighbor.hp <= 0) this.impulse(neighbor, chain, 0, 0, force * 0.56, now, 0.50)
      }
    }
  }

  private pickTarget(runner: Runner, hook: boolean) {
    let target: Enemy | undefined
    let best = Infinity
    for (const enemy of this.enemies) {
      const distance = enemy.z - runner.z
      const offset = Math.abs(enemy.x - runner.x)
      const width = enemy.type === 'bulldog' ? 1.42 : hook && this.build.rank('wave') ? 1.94 : hook ? 1.06 : 0.75
      if (enemy.hp <= 0 || distance < -0.28 || distance > this.balance.reach + (hook ? 0.28 : 0) ||
        offset > width || enemy.y > 1.25) continue
      const priority = distance + offset * 0.9
      if (priority < best) {
        target = enemy
        best = priority
      }
    }
    return target
  }

  private hit(enemy: Enemy, damage: number, now: number, kind: Effect, points?: number) {
    this.combo++
    this.comboLeft = this.balance.comboGrace
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.events.push({ kind, x: enemy.x, z: enemy.z, enemy: enemy.id, points })
    this.damage(enemy, damage, now)
    const fire = this.build.rank('fire')
    if (fire && enemy.hp > 0) {
      if (!enemy.burnTicks) {
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
      if (enemy.type === 'bulldog' && enemy.bossPhase === 1 && enemy.hp < enemy.maxHp / 2) {
        enemy.bossPhase = 2
        this.emit('rage', enemy.x, enemy.z, enemy.id)
        if (enemy.pose !== 'telegraph' && enemy.pose !== 'attack' && enemy.pose !== 'stunned') setPose(enemy, 'rage', now, 0.44)
      }
      return
    }
    enemy.removeAt = now + 1.24
    enemy.burnTicks = 0
    setPose(enemy, 'fall', now, 0.26)
    this.kills++
    const stats = this.balance.enemies[enemy.type]
    this.xp += stats.xp
    this.score += enemy.type === 'bulldog' ? stats.score : Math.round(stats.score * this.multiplier)
  }

  private impulse(enemy: Enemy, chain: Chain | undefined, depth: number, vx: number, vz: number, now: number,
    length: number, uppercut = false) {
    enemy.chain = chain
    enemy.depth = depth
    enemy.vx = vx
    enemy.vz = vz * this.balance.enemies[enemy.type].resistance
    enemy.flightUntil = now + length
    if (uppercut) {
      enemy.y = Math.max(0.04, enemy.y)
      enemy.vy = 5.7
    }
    setPose(enemy, uppercut ? 'airborne' : enemy.hp <= 0 ? 'fall' : Math.abs(vx) > 3 ? 'sideFlight' : 'knockback', now, length)
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
    this.combo = this.short = 0
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

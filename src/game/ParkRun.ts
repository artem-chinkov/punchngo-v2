import { CombatSystem } from '../combat/CombatSystem'
import { setPose } from '../combat/EnemyAI'
import type { Balance } from '../combat/balance'
import type { WorldSettings } from '../world/route'
import { EncounterDirector } from './EncounterDirector'
import { Random } from './random'
import { Runner } from './Runner'
import { levelXP, type UpgradeId } from './upgrades'

export type Phase = 'ready' | 'park' | 'upgrade' | 'boss' | 'finisher' | 'victory' | 'defeat'

export interface Result {
  won: boolean
  score: number
  rank: string
  kills: number
  bestCombo: number
  counters: number
  perfect: number
  hp: number
  time: number
  cause: string
  seed: number
}

export class ParkRun {
  phase: Phase = 'ready'
  now = 0
  level = 1
  offer: UpgradeId[] = []
  finishAge = 0
  readonly runner: Runner
  readonly combat: CombatSystem
  private readonly director: EncounterDirector
  private readonly rewardRandom: Random
  private nextSupport = Infinity

  constructor(readonly balance: Balance, readonly world: WorldSettings, readonly seed: number) {
    this.runner = new Runner(balance)
    this.combat = new CombatSystem(balance)
    this.director = new EncounterDirector(seed, balance)
    this.rewardRandom = new Random(seed ^ 0x2566adb1)
  }

  get active() { return this.phase === 'park' || this.phase === 'boss' }
  get finished() { return this.phase === 'victory' || this.phase === 'defeat' }
  get visualTime() { return this.now + this.finishAge * 0.48 }

  start() { if (this.phase === 'ready') this.phase = 'park' }
  tap() { return this.active && this.combat.tap(this.runner, this.now) }
  swipe(direction: -1 | 1) { if (this.active) this.runner.changeLane(direction) }
  clearInput() { this.combat.clearInput() }

  choose(id: UpgradeId) {
    if (this.phase !== 'upgrade' || !this.offer.includes(id) || !this.combat.take(id)) return false
    this.offer = []
    this.phase = 'park'
    this.checkLevel()
    return true
  }

  update(dt: number, invulnerable = false) {
    if (this.phase === 'finisher') {
      this.finishAge += dt
      const boss = this.combat.boss!
      const slow = dt * 0.37
      this.runner.advance(slow)
      boss.z += slow * (this.balance.speed + 8)
      boss.y = Math.max(0, Math.sin(Math.min(1, this.finishAge / 0.98) * Math.PI)) * 1.48
      boss.x *= Math.exp(-slow * 2)
      if (this.finishAge >= 1.05) this.phase = 'victory'
      return
    }
    if (!this.active) return
    this.now += dt
    this.runner.advance(dt)
    if (this.phase === 'park' && this.now >= this.balance.bossAt) this.beginBoss()
    if (this.phase === 'park') {
      this.director.update(this.now, this.runner, this.combat.enemies,
        (type, lane, z, scale) => this.combat.spawn(type, lane, z, this.now, scale))
    } else this.support()

    this.combat.update(this.runner, this.now, dt, invulnerable)
    if (this.combat.hp <= 0) {
      this.phase = 'defeat'
      this.clearInput()
    } else if (this.combat.boss && this.combat.boss.hp <= 0) {
      this.phase = 'finisher'
      this.clearInput()
      this.combat.finish(this.runner, this.now)
    } else if (this.phase === 'park') this.checkLevel()
  }

  private checkLevel() {
    while (this.combat.xp >= levelXP(this.level + 1)) {
      this.level++
      this.offer = this.combat.build.offer(this.rewardRandom, this.combat.hp, this.balance.hp)
      if (!this.offer.length) continue
      this.phase = 'upgrade'
      this.clearInput()
      this.combat.events.push({ kind: 'level', x: this.runner.x, z: this.runner.z })
      return
    }
  }

  private beginBoss() {
    this.phase = 'boss'
    this.combat.enemies.length = 0
    this.combat.spawn('bulldog', 0, this.runner.z + 24, this.now)
  }

  private support() {
    const boss = this.combat.boss!
    if (boss.bossPhase !== 2 || boss.hp <= 0) return
    if (this.nextSupport === Infinity) this.nextSupport = this.now + 0.85
    if (this.now < this.nextSupport) return
    this.nextSupport = this.now + 4.4
    if (this.combat.enemies.some(enemy => enemy.type !== 'bulldog' && enemy.hp > 0 && enemy.z > this.runner.z)) return
    const flank = this.rewardRandom.next() < 0.5 ? -1 : 1
    const z = this.runner.z + 12.6
    const lane = this.runner.lane
    this.combat.spawn('thug', lane, z, this.now)
    if (this.rewardRandom.next() < 0.6) this.combat.spawn('thug', lane === 0 ? flank : 0, z + 3.1, this.now)
  }

  debugBoss() {
    this.now = Math.max(this.now, this.balance.bossAt)
    this.clearInput()
    this.beginBoss()
  }

  debugPhase(phase: 1 | 2) {
    const boss = this.combat.boss
    if (!boss || boss.hp <= 0) return
    boss.bossPhase = phase
    boss.hp = boss.maxHp * (phase === 1 ? 1 : 0.48)
    this.nextSupport = Infinity
    this.combat.enemies.splice(0, this.combat.enemies.length, boss)
    setPose(boss, 'rage', this.now, 0.4)
    this.combat.events.push({ kind: 'rage', x: boss.x, z: boss.z, enemy: boss.id })
  }

  debugProgress(xp: number, level: number) {
    this.combat.xp = Math.max(0, Math.floor(xp))
    this.level = Math.max(1, Math.floor(level))
  }

  result(): Result {
    const { score, hp, kills, bestCombo, counters, perfect, damageCause } = this.combat
    return { won: this.phase === 'victory', score, rank: score >= this.balance.rankS ? 'S' :
      score >= this.balance.rankA ? 'A' : score >= this.balance.rankB ? 'B' : 'C',
    kills, bestCombo, counters, perfect, hp: Math.ceil(hp), time: this.now, cause: damageCause, seed: this.seed }
  }
}

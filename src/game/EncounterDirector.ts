import type { RegularType } from '../assets/ids'
import type { Balance } from '../combat/balance'
import type { Enemy } from '../combat/EnemyAI'
import { Random } from './random'
import type { Runner } from './Runner'
import type { Lane } from '../world/route'

type Slot = readonly [Lane, number, RegularType?]
interface Pattern { name: string; stage: number; slots: readonly Slot[] }
const patterns: readonly Pattern[] = [
  { name: 'solo', stage: 0, slots: [[0, 0]] },
  { name: 'pair', stage: 0, slots: [[-1, 0], [1, 1.6]] },
  { name: 'chain', stage: 0, slots: [[0, 0], [0, 2.1], [0, 4.4]] },
  { name: 'diagonal', stage: 0, slots: [[-1, 0], [0, 2.4], [1, 5]] },
  { name: 'flank', stage: 1, slots: [[1, 0], [1, 2.2], [0, 3.5], [1, 4.7, 'quick']] },
  { name: 'escort', stage: 1, slots: [[0, 1.4, 'brute'], [-1, 0], [1, 3.6], [0, 5.4]] },
  { name: 'cross', stage: 2, slots: [[-1, 0, 'quick'], [1, 0.8], [0, 3.1, 'brute'], [1, 5.2], [-1, 6.4]] },
  { name: 'pack', stage: 3, slots: [[0, 0], [0, 2], [1, 2.5, 'quick'], [-1, 4.5], [0, 5.5, 'brute']] },
]

export type Spawn = (type: RegularType, lane: Lane, z: number, scale: number) => void

export class EncounterDirector {
  private readonly random: Random
  private next = 0.45
  private last = ''
  private cycle = 0

  constructor(seed: number, private readonly balance: Balance) { this.random = new Random(seed) }

  update(now: number, runner: Runner, enemies: Enemy[], spawn: Spawn) {
    if (now < this.next || now >= this.balance.bossAt - 7) return
    const stage = Math.min(3, Math.floor(now / 40))
    const tide = Math.sin(now / 6.8)
    const ceiling = Math.max(2, Math.min(12, Math.round(([4, 6, 8, 10][stage] + (tide < -0.4 ? -1 : 0)) * this.balance.density)))
    let count = 0
    let front = runner.z
    let active = 0
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.z < runner.z) continue
      count++
      front = Math.max(front, enemy.z)
      if (enemy.z - runner.z < 8) active++
    }
    if (count >= ceiling || active >= ceiling - 1) return

    const slots = ceiling - count
    const candidates = patterns.filter(pattern => pattern.stage <= stage && pattern.name !== this.last &&
      pattern.slots.length <= slots && (stage === 0 || pattern.slots.length > 1 || slots < 2))
    const pattern = candidates.length ? candidates[this.random.index(candidates.length)] : patterns[0]
    this.last = pattern.name
    this.cycle++
    const mirror = this.random.next() < 0.5 ? -1 : 1
    const base = Math.max(runner.z + Math.max(14, runner.speed * 2.35 + 3.6), Math.min(front + 2.5, runner.z + 28))
    const spacing = 1 + Math.max(0, runner.speed / this.balance.speed - 1) * 0.22
    for (const [position, offset, preset] of pattern.slots) {
      let lane = (position * mirror) as Lane
      if (pattern.name === 'solo' && this.cycle % 3 === 1) lane = runner.lane
      const roll = this.random.next()
      const type = preset ?? (stage > 0 && roll > 0.87 ? 'brute' : roll > 0.66 ? 'quick' : 'thug')
      spawn(type, lane, base + offset * spacing, 1 + stage * 0.09)
    }
    this.next = now + ([2.18, 1.85, 1.55, 1.30][stage] + (1 - tide) * 0.23 + this.random.next() * 0.44) /
      this.balance.spawnRate
  }
}

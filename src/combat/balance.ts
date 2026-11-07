import type { EnemyType } from '../assets/ids'

export interface EnemyBalance {
  hp: number
  contact: number
  damage: number
  speed: number
  windup: number
  recovery: number
  resistance: number
  score: number
  xp: number
}

export interface Balance {
  hp: number
  speed: number
  dashMultiplier: number
  dashLimit: number
  dashDuration: number
  laneDuration: number
  punchInterval: number
  inputBuffer: number
  damage: number
  reach: number
  knockback: number
  chainDamage: number
  chainDepth: number
  chainTargets: number
  immunity: number
  counterWindow: number
  idealWindow: number
  idealTapGap: number
  counterDamage: number
  idealDamage: number
  counterStun: number
  regularCounterStun: number
  counterScore: number
  idealScore: number
  attackGap: number
  comboGrace: number
  comboDecay: number
  spawnRate: number
  density: number
  bossAt: number
  rankS: number
  rankA: number
  rankB: number
  enemies: Record<EnemyType, EnemyBalance>
}

export const defaultBalance: Balance = {
  hp: 100, speed: 6.4, dashMultiplier: 2, dashLimit: 2.12, dashDuration: 0.5, laneDuration: 0.18,
  punchInterval: 0.25, inputBuffer: 0.105, damage: 24, reach: 3.2, knockback: 13,
  chainDamage: 0.5, chainDepth: 2, chainTargets: 5, immunity: 0.8,
  counterWindow: 0.23, idealWindow: 0.075, idealTapGap: 1.35, counterDamage: 1.75, idealDamage: 2.15,
  counterStun: 1, regularCounterStun: 0.52, counterScore: 50, idealScore: 100,
  attackGap: 0.48, comboGrace: 2.5, comboDecay: 0.45, spawnRate: 1, density: 1, bossAt: 140,
  rankS: 39000, rankA: 31000, rankB: 22500,
  enemies: {
    thug: { hp: 33, contact: 5, damage: 15, speed: 0.55, windup: 0.60, recovery: 0.46, resistance: 1, score: 100, xp: 16 },
    quick: { hp: 23, contact: 5, damage: 15, speed: 1.35, windup: 0.46, recovery: 0.34, resistance: 1.08, score: 150, xp: 21 },
    brute: { hp: 65, contact: 8, damage: 20, speed: 0.26, windup: 0.76, recovery: 0.60, resistance: 0.67, score: 250, xp: 31 },
    bulldog: { hp: 1450, contact: 0, damage: 26, speed: 2.1, windup: 0.86, recovery: 0.31, resistance: 0.87, score: 1000, xp: 0 },
  },
}

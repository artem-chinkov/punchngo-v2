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
  holdSlowdownPerSecond: number
  holdMinSpeedPercent: number
  dashMultiplier: number
  dashLimit: number
  dashDuration: number
  laneDuration: number
  punchInterval: number
  minPunchInterval: number
  holdHurtPause: number
  specialCooldown: number
  superSpeed: number
  superDuration: number
  superPrepare: number
  superFade: number
  superRecovery: number
  superDamage: number
  electricDamage: number
  electricRadius: number
  uppercutAnimation: number
  uppercutWindup: number
  uppercutDrive: number
  uppercutFlight: number
  uppercutTransfer: number
  uppercutMaxSpeed: number
  uppercutChainDepth: number
  counterTutorialLock: number
  uppercutDamage: number
  uppercutLift: number
  uppercutForce: number
  landingDamage: number
  landingRadius: number
  sideDamage: number
  sideForce: number
  sideImpulse: number
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
  hp: 100, speed: 6.4, holdSlowdownPerSecond: 15, holdMinSpeedPercent: 25,
  dashMultiplier: 2, dashLimit: 2.12, dashDuration: 0.5, laneDuration: 0.18,
  punchInterval: 0.25, minPunchInterval: 0.18, holdHurtPause: 0.12,
  specialCooldown: 0.7, superSpeed: 2.8, superDuration: 1.2, superPrepare: 0.1, superFade: 0.3,
  superRecovery: 0.8, superDamage: 0.5, electricDamage: 0.55, electricRadius: 3.9,
  uppercutAnimation: 0.55, uppercutWindup: 0.12, uppercutDrive: 0.13, uppercutFlight: 0.95,
  uppercutTransfer: 1.04, uppercutMaxSpeed: 48, uppercutChainDepth: 2, counterTutorialLock: 2.5,
  uppercutDamage: 1.4, uppercutLift: 6.4, uppercutForce: 2.3, landingDamage: 0.4, landingRadius: 1.9,
  sideDamage: 0.7, sideForce: 0.82, sideImpulse: 6.2,
  inputBuffer: 0.105, damage: 24, reach: 3.2, knockback: 13,
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

// Keep at least one fixed simulation step for the driven phase at extreme DEV settings.
export function superTiming(balance: Balance) {
  const duration = Math.max(0.05, balance.superDuration)
  const prepare = Math.min(balance.superPrepare, duration - 1 / 60)
  const fade = Math.min(balance.superFade, duration - prepare - 1 / 60)
  return { duration, prepare, fade, cruiseEnd: duration - fade, handsReady: Math.min(duration, prepare + 0.09) }
}

export function uppercutTiming(balance: Balance) {
  const duration = Math.max(0.08, balance.uppercutAnimation)
  const windup = Math.min(balance.uppercutWindup, duration - 0.04)
  const drive = Math.min(balance.uppercutDrive, duration - windup - 0.02)
  return { duration, windup, drive }
}

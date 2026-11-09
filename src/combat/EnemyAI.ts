import type { EnemyPose, EnemyType } from '../assets/ids'
import type { Runner } from '../game/Runner'
import { laneX, type Lane } from '../world/route'
import type { Balance } from './balance'

export interface Chain {
  visited: Set<number>
  kind?: 'uppercut' | 'body'
}

export interface Enemy {
  id: number
  type: EnemyType
  lane: Lane
  destination: Lane
  x: number
  z: number
  previousX: number
  previousZ: number
  previousY: number
  y: number
  vy: number
  vx: number
  vz: number
  hp: number
  maxHp: number
  pose: EnemyPose
  since: number
  until: number
  nextLane: number
  contactUntil: number
  contactSide: -1 | 0 | 1
  flightUntil: number
  chain?: Chain
  landingWave?: Chain
  depth: number
  removeAt: number
  burnTicks: number
  burnAt: number
  burnDamage: number
  bossPhase: 1 | 2
  dashPushed: boolean
}

export function createEnemy(id: number, type: EnemyType, lane: Lane, z: number, hp: number, now: number): Enemy {
  const x = laneX(lane)
  return { id, type, lane, destination: lane, x, z, previousX: x, previousZ: z, previousY: 0, y: 0, vy: 0, vx: 0, vz: 0,
    hp, maxHp: hp, pose: 'approach', since: now, until: now, nextLane: now + 0.55 + (id % 3) * 0.24,
    contactUntil: 0, contactSide: 0, flightUntil: 0, depth: 0, removeAt: Infinity,
    burnTicks: 0, burnAt: Infinity, burnDamage: 0, bossPhase: 1, dashPushed: false }
}

export function setPose(enemy: Enemy, pose: EnemyPose, now: number, duration = 0) {
  enemy.pose = pose
  enemy.since = now
  enemy.until = now + duration
}

export function inCounterWindow(enemy: Enemy, now: number, balance: Balance) {
  return enemy.hp > 0 && enemy.pose === 'telegraph' && now >= enemy.until - balance.counterWindow && now < enemy.until
}

function toward(from: number, to: number, distance: number) {
  return from + Math.sign(to - from) * Math.min(Math.abs(to - from), distance)
}

export const flightEdge = 2.55

export function moveFlightPlanar(enemy: Enemy, dt: number, forward = 0) {
  enemy.z += enemy.vz * dt + forward
  enemy.x = Math.max(-flightEdge, Math.min(flightEdge, enemy.x + enemy.vx * dt))
  const drag = Math.exp(-1.45 * dt)
  enemy.vx *= drag
  enemy.vz *= drag
}

export class EnemyAI {
  private nextAttack = 0

  constructor(private readonly balance: Balance) {}

  update(enemies: Enemy[], runner: Runner, now: number, dt: number,
    strike: (enemy: Enemy) => void, land: (enemy: Enemy) => void) {
    let bossThreat = false
    let active = false
    let candidate: Enemy | undefined
    for (const enemy of enemies) {
      enemy.previousX = enemy.x
      enemy.previousZ = enemy.z
      enemy.previousY = enemy.y
      if (enemy.dashPushed) continue
      if (this.advanceFlight(enemy, runner, now, dt, land) || enemy.hp <= 0) continue
      if (enemy.type === 'bulldog') {
        this.boss(enemy, runner, now, dt, strike)
        bossThreat = enemy.pose === 'telegraph' || enemy.pose === 'attack' || enemy.z - runner.z < 4.4
        continue
      }
      this.regular(enemy, runner, now, dt, strike)
      const distance = enemy.z - runner.z
      const offset = Math.abs(enemy.x - runner.x)
      if ((distance > 0.55 || offset >= 0.66) && (enemy.pose === 'telegraph' || enemy.pose === 'attack')) active = true
      if (distance >= 0.75 && distance <= 5.65 && offset < 0.75 &&
        (enemy.pose === 'approach' || enemy.pose === 'idle') && (!candidate || enemy.z < candidate.z)) candidate = enemy
    }
    if (candidate && !active && !bossThreat && now >= this.nextAttack) {
      const windup = this.balance.enemies[candidate.type].windup
      this.nextAttack = now + windup + this.balance.attackGap
      setPose(candidate, 'telegraph', now, windup)
    }
  }

  private advanceFlight(enemy: Enemy, runner: Runner, now: number, dt: number, land: (enemy: Enemy) => void) {
    if (now >= enemy.flightUntil && enemy.y <= 0) {
      enemy.chain = undefined
      if (enemy.pose === 'airborne' || enemy.pose === 'sideFlight' || enemy.pose === 'knockback' || enemy.pose === 'hit') {
        setPose(enemy, enemy.hp > 0 ? 'recovery' : 'fall', now, 0.22)
      }
      if (enemy.pose === 'fall' && now >= enemy.until) setPose(enemy, 'defeated', now)
      return false
    }

    const wasAirborne = enemy.y > 0
    const bossMotion = enemy.type === 'bulldog' && enemy.hp > 0 ? runner.z - runner.previousZ : 0
    moveFlightPlanar(enemy, dt, bossMotion)
    enemy.y = Math.max(0, enemy.y + enemy.vy * dt)
    enemy.vy = enemy.y > 0 ? enemy.vy - 21 * dt : 0
    if (wasAirborne && enemy.y === 0) {
      if (enemy.pose === 'airborne') setPose(enemy, enemy.hp > 0 ? 'knockback' : 'fall', now, 0.20)
      land(enemy)
    }
    return true
  }

  private regular(enemy: Enemy, runner: Runner, now: number, dt: number, strike: (enemy: Enemy) => void) {
    const stats = this.balance.enemies[enemy.type]
    if (enemy.pose === 'telegraph') {
      enemy.z -= stats.speed * dt * 0.35
      if (now >= enemy.until) {
        setPose(enemy, 'attack', now, 0.16)
        if (enemy.z - runner.z <= 2.65 && enemy.z - runner.z > -0.4 && Math.abs(enemy.x - runner.x) < 0.84) strike(enemy)
      }
      return
    }
    if (enemy.pose === 'attack') {
      if (now >= enemy.until) setPose(enemy, 'recovery', now, stats.recovery)
      return
    }
    if (enemy.pose === 'stunned' || enemy.pose === 'recovery') {
      if (now < enemy.until) return
      setPose(enemy, 'approach', now)
    }

    enemy.z -= stats.speed * dt
    if (enemy.pose === 'laneTell') {
      if (now >= enemy.until) setPose(enemy, 'positioning', now)
      return
    }
    const targetX = laneX(enemy.destination)
    const lateral = enemy.type === 'quick' ? 5.25 : 1.9
    enemy.x = toward(enemy.x, targetX, lateral * dt)
    if (enemy.x === targetX) {
      enemy.lane = enemy.destination
      if (enemy.pose === 'positioning') setPose(enemy, 'approach', now)
    }
    const distance = enemy.z - runner.z
    if (enemy.type === 'quick' && enemy.pose === 'approach' && now >= enemy.nextLane && distance > 6.3 && distance < 15.5) {
      const direction = enemy.lane === 0 ? (enemy.id % 2 ? -1 : 1) : -enemy.lane
      enemy.destination = (enemy.lane + direction) as Lane
      enemy.nextLane = now + 3.1
      setPose(enemy, 'laneTell', now, 0.30)
    }
  }

  private boss(enemy: Enemy, runner: Runner, now: number, dt: number, strike: (enemy: Enemy) => void) {
    const stats = this.balance.enemies.bulldog
    const move = runner.z - runner.previousZ
    // The ram's swept solver owns the barrier during powered movement. Following
    // the proposed camera position here would move the boss out of its way.
    const follow = () => {
      if (runner.superSweepTo <= runner.superSweepFrom) enemy.z = Math.max(runner.z + 1.12, enemy.z)
    }

    if (enemy.pose === 'stunned' || enemy.pose === 'rage' || enemy.pose === 'recovery') {
      follow()
      if (now < enemy.until) return
      setPose(enemy, 'approach', now)
    }
    if (enemy.pose === 'attack') {
      enemy.x = toward(enemy.x, runner.x, 12 * dt)
      follow()
      if (now >= enemy.until) setPose(enemy, 'retreat', now, 0.55)
      return
    }
    if (enemy.pose === 'retreat') {
      const progress = Math.min(1, (now - enemy.since) / 0.55)
      enemy.z += move + (1 - progress) * 16 * dt
      enemy.x = toward(enemy.x, 0, 4 * dt)
      if (now >= enemy.until) setPose(enemy, 'recovery', now, stats.recovery)
      return
    }
    if (enemy.pose === 'telegraph') {
      enemy.z -= stats.speed * 0.50 * dt
      enemy.x = toward(enemy.x, runner.x, (now > enemy.until - 0.12 ? 8 : 1.1) * dt)
      follow()
      if (now >= enemy.until) {
        setPose(enemy, 'attack', now, 0.17)
        if (enemy.z - runner.z <= 3.55) strike(enemy)
      }
      return
    }
    enemy.z -= stats.speed * (enemy.bossPhase === 2 ? 1.40 : 1) * dt
    enemy.x = toward(enemy.x, runner.x * 0.56, 2.6 * dt)
    follow()
    if (enemy.z - runner.z <= 5.35) {
      setPose(enemy, 'telegraph', now, stats.windup * (enemy.bossPhase === 2 ? 0.76 : 1))
    }
  }
}

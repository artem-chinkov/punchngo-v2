import type { Runner } from '../game/Runner'
import { laneAt, route } from '../world/route'
import { setPose, type Enemy } from './EnemyAI'
import { sweepBox } from './sweep'

export const dashHeadGap = 2.3
export const dashSpacing = 0.8
const settleSpeed = 6
type Point = { x: number; z: number }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const approach = (a: number, b: number, distance: number) => a + Math.sign(b - a) * Math.min(Math.abs(b - a), distance)

/** A ram is a kinematic train, never a damage-bearing projectile Chain. */
export class DashPush {
  readonly members: Enemy[] = []
  readonly touched = new Set<number>()
  active = false
  directHitSpent = false
  private readonly ejected = new Set<number>()

  start(now: number) {
    this.release(now)
    this.active = true
    this.directHitSpent = false
    this.ejected.clear()
    this.touched.clear()
  }

  detach(enemy: Enemy) {
    enemy.dashPushed = false
    const index = this.members.indexOf(enemy)
    if (index >= 0) {
      this.members.splice(index, 1)
      this.ejected.add(enemy.id)
    }
  }

  release(now: number) {
    for (const enemy of this.members) {
      enemy.dashPushed = false
      enemy.vx = enemy.vz = enemy.vy = 0
      enemy.contactSide = 0
      enemy.contactUntil = 0
      enemy.lane = enemy.destination = laneAt(enemy.x)
      if (enemy.hp > 0) setPose(enemy, 'approach', now)
    }
    this.members.length = 0
    this.active = false
  }

  update(runner: Runner, enemies: Enemy[], now: number, dt: number, wave: boolean,
    firstHit: (enemy: Enemy, point: Point) => void) {
    this.touched.clear()
    if (!this.active) return
    for (const enemy of [...this.members]) {
      if (!enemy.dashPushed || enemy.hp <= 0 || !enemies.includes(enemy)) this.detach(enemy)
    }
    const from = runner.superSweepFrom, to = runner.superSweepTo
    if (to <= from) {
      if (!runner.superActive) this.release(now)
      return
    }
    const paths = new Map(enemies.map(enemy => [enemy, {
      x0: enemy.previousX, z0: enemy.previousZ, x1: enemy.x, z1: enemy.z,
    }]))
    const freePoint = (enemy: Enemy, t: number): Point => {
      const p = paths.get(enemy)!
      return { x: mix(p.x0, p.x1, t), z: mix(p.z0, p.z1, t) }
    }
    let blockedAt = Infinity
    let cursor = from
    const heroPoint = (t: number): Point => ({
      x: mix(runner.previousX, runner.x, t),
      z: Math.min(blockedAt, mix(runner.superSweepZFrom, runner.superSweepZTo, (t - from) / (to - from))),
    })
    const contacted = new Set<number>()
    // Each iteration consumes a new contact or the entire remaining interval.
    // The bound is the number of actual enemies, not a gameplay target limit.
    while (cursor < to - 1e-12) {
      const hero = heroPoint(cursor), endHero = heroPoint(to)
      const duration = Math.max(0, dt * (to - cursor))
      const travel = endHero.z - hero.z
      const plans = new Map<Enemy, Point>()
      let previous: Enemy | undefined
      for (const enemy of this.members) {
        const desired = previous ? plans.get(previous)!.z + dashSpacing : endHero.z + dashHeadGap
        let z = Number.isFinite(blockedAt) ? enemy.z : approach(enemy.z + travel, desired, settleSpeed * duration)
        // Do not merge adjacent-lane captures until there is room in the row.
        const room = this.members.every(other => other === enemy || Math.abs(enemy.z - other.z) >= dashSpacing - 1e-8)
        const offset = enemy.x - hero.x
        const x = endHero.x + (room ? approach(offset, 0, 5.25 * duration) : offset)
        if (previous && Math.abs(x - plans.get(previous)!.x) < 0.72 &&
          enemy.z - previous.z >= dashSpacing - 1e-8) z = Math.max(z, plans.get(previous)!.z + dashSpacing)
        plans.set(enemy, { x, z })
        previous = enemy
      }
      let earliest = Infinity
      let target: Enemy | undefined
      const sources: (Enemy | undefined)[] = [undefined, ...this.members]
      for (const source of sources) {
        const start = source ?? hero
        const end = source ? plans.get(source)! : endHero
        for (const enemy of enemies) {
          // Catch low forward flights (including electricity); explicit ejections
          // from this train and lateral/airborne projectiles keep their physics.
          if (enemy.hp <= 0 || enemy.dashPushed || contacted.has(enemy.id) ||
            (enemy.type !== 'bulldog' && (enemy.previousY > 0.05 || enemy.y > 0.05 || (now - dt < enemy.flightUntil &&
              (this.ejected.has(enemy.id) || Math.abs(enemy.vx) > 0.05))))) continue
          const p = freePoint(enemy, cursor), q = freePoint(enemy, to)
          if (p.z - start.z < -0.18) continue
          const boss = enemy.type === 'bulldog'
          const ahead = source ? (boss ? 0.9 : dashSpacing) : dashHeadGap
          const width = boss ? Infinity : wave ? route.laneWidth + 0.72 : 0.72
          const local = sweepBox(p.x - start.x, p.z - start.z, 0,
            q.x - p.x - (end.x - start.x), q.z - p.z - (end.z - start.z), 0, width, 0.18, ahead, 1.1)
          if (!Number.isFinite(local)) continue
          const time = mix(cursor, to, local)
          if (wave && !boss && Math.abs(laneAt(mix(p.x, q.x, local)) - laneAt(heroPoint(time).x)) > 1) continue
          if (time < earliest - 1e-10 || (Math.abs(time - earliest) <= 1e-10 && enemy.id < (target?.id ?? Infinity))) {
            earliest = time
            target = enemy
          }
        }
      }
      const end = target ? earliest : to
      const progress = (end - cursor) / (to - cursor)
      for (const enemy of this.members) {
        const point = plans.get(enemy)!
        enemy.x = mix(enemy.x, point.x, progress)
        enemy.z = mix(enemy.z, point.z, progress)
      }
      cursor = end
      if (!target) break
      contacted.add(target.id)
      this.touched.add(target.id)
      const point = freePoint(target, cursor)
      if (!this.directHitSpent) {
        this.directHitSpent = true
        firstHit(target, point)
      }
      if (target.hp <= 0) continue
      if (target.type === 'bulldog') {
        blockedAt = heroPoint(cursor).z
        continue
      }
      target.x = point.x
      target.z = point.z
      target.dashPushed = true
      target.chain = target.landingWave = undefined
      target.vx = target.vz = target.vy = 0
      target.flightUntil = 0
      target.contactSide = 0
      target.contactUntil = 0
      setPose(target, 'dashPushed', now)
      this.members.push(target)
    }
    for (const enemy of this.members) {
      this.touched.add(enemy.id)
      enemy.lane = enemy.destination = laneAt(enemy.x)
    }
    if (Number.isFinite(blockedAt)) {
      runner.limitForward(blockedAt)
      const boss = enemies.find(enemy => enemy.type === 'bulldog' && enemy.hp > 0)
      if (boss) boss.z = this.members.reduce((z, enemy) => Math.max(z, enemy.z + 0.9), Math.max(boss.z, runner.z + dashHeadGap))
    }
    if (!runner.superActive) this.release(now)
  }
}

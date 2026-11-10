import type Phaser from 'phaser'
import type { AssetRegistry } from '../assets/AssetRegistry'
import type { AnimationState, EnemyPose, EnemyType, Hand, HandPose } from '../assets/ids'
import type { CombatEvent, Effect, Strike } from '../combat/CombatSystem'
import { createEnemy, type Enemy } from '../combat/EnemyAI'
import type { ParkRun } from '../game/ParkRun'
import type { TutorialDemo } from '../game/TutorialDemo'
import { superTiming, uppercutTiming } from '../combat/balance'
import { superHandMotion } from './AttackMotion'
import { uppercutFrame } from '../combat/Uppercut'
import { laneAt, laneX, route } from '../world/route'
import type { PerspectiveProjector } from './PerspectiveProjector'

const hands = ['left', 'right'] as const
const colors: Record<Effect, number> = {
  hit: 0xffefbd, dashImpact: 0xffa554, ricochet: 0xffd982, counter: 0xffdc66, ideal: 0xfff383, chain: 0x73efd1,
  air: 0xf7d17d, wave: 0xffb975, electric: 0x84efff, fire: 0xff7537, hurt: 0xf05142,
  miss: 0xe5dbac, rage: 0xf34a49, finish: 0xffcf60, level: 0x9effce, side: 0xffc26e, landing: 0xffd686,
  bodyContact: 0xf5c891, bodyShove: 0xcfaa82,
}
interface Particle extends CombatEvent { at: number }
interface Slot {
  image: Phaser.GameObjects.Image
  id: number
  seen: number
  freezeUntil: number
  frozeAt: number
}
export interface TutorialFocus { x: number; y: number; rx: number; ry: number }
export interface AnimationPreview { type: EnemyType | 'hero'; pose: AnimationState; start: number }

export class CombatView {
  private readonly slots: Slot[] = []
  private readonly fists: Record<Hand, Phaser.GameObjects.Image>
  private readonly marks: Phaser.GameObjects.Graphics
  private readonly warnings: Phaser.GameObjects.Graphics
  private readonly effects: Phaser.GameObjects.Graphics
  private readonly dashFlashes: Phaser.GameObjects.Graphics
  private readonly damageFrame: Phaser.GameObjects.Graphics
  private readonly shadows: Phaser.GameObjects.Graphics
  private readonly upperWave: Phaser.GameObjects.Graphics
  private readonly previewImage: Phaser.GameObjects.Image
  private readonly previewEnemy = createEnemy(-1, 'thug', 0, 0, 100, 0)
  private readonly particles: Particle[] = []
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  tutorialFocus?: TutorialFocus
  private frame = 0
  private hurtAt = -Infinity
  private bodyAt = -Infinity
  private bodySide = 1
  private defeatAt = -Infinity

  constructor(scene: Phaser.Scene, private readonly assets: AssetRegistry) {
    this.shadows = scene.add.graphics().setDepth(-9998)
    this.upperWave = scene.add.graphics().setDepth(0.5)
    this.marks = scene.add.graphics().setDepth(1)
    this.warnings = scene.add.graphics().setDepth(3.5)
    this.effects = scene.add.graphics().setDepth(2)
    this.dashFlashes = scene.add.graphics().setDepth(3.2)
    this.damageFrame = scene.add.graphics().setDepth(4)
    this.fists = { left: assets.image('fist.left').setDepth(3), right: assets.image('fist.right').setDepth(3) }
    this.previewImage = assets.image('thug').setVisible(false)
    for (let i = 0; i < 15; i++) this.slots.push(this.newSlot())
  }

  reset() {
    for (const slot of this.slots) {
      slot.id = 0
      slot.freezeUntil = 0
      slot.image.setVisible(false)
    }
    this.particles.length = 0
    this.hurtAt = this.defeatAt = this.bodyAt = -Infinity
  }

  bodyRecoil(wall: number) {
    return this.reducedMotion.matches ? 0 : Math.max(0, 1 - (wall - this.bodyAt) / 0.13)
  }

  show(event: CombatEvent, now: number, wall: number) {
    if (event.kind === 'bodyContact' && wall - this.bodyAt >= 0.08) {
      this.bodyAt = wall
      this.bodySide = event.direction ?? 1
    }
    if (event.kind === 'hurt') this.hurtAt = wall
    else {
      if (this.particles.length >= 30) this.particles.shift()
      this.particles.push({ ...event, at: now })
      if (event.enemy !== undefined && (event.kind === 'hit' || event.kind === 'dashImpact' || event.kind === 'ricochet' ||
        event.kind === 'counter' || event.kind === 'ideal' || event.kind === 'chain' ||
        event.kind === 'side' || event.kind === 'air')) {
        const slot = this.slots.find(item => item.id === event.enemy)
        if (slot) {
          slot.frozeAt = now
          slot.freezeUntil = now + (event.kind === 'ideal' || event.kind === 'air' ? 0.085 : 0.047)
        }
      }
    }
  }

  draw(run: ParkRun, projector: PerspectiveProjector, wall: number, debug: boolean, preview?: AnimationPreview, demo?: TutorialDemo) {
    this.frame++
    this.tutorialFocus = undefined
    this.shadows.clear()
    this.upperWave.clear()
    this.marks.clear()
    this.warnings.clear()
    this.effects.clear()
    this.dashFlashes.clear()
    this.damageFrame.clear()
    this.previewImage.setVisible(false)
    const { width, height } = projector
    const now = run.visualTime
    const counter = run.combat.counterTarget(run.runner, run.now)
    if (debug) this.drawZones(run, projector)
    for (const enemy of run.combat.enemies) {
      const point = projector.project(enemy.x, enemy.z)
      if (!point.visible || point.x < -140 || point.x > width + 140) continue
      let slot = this.slots.find(item => item.id === enemy.id)
      if (!slot) {
        slot = this.slots.find(item => item.id === 0)
        if (!slot) {
          slot = this.newSlot()
          this.slots.push(slot)
        }
        slot.id = enemy.id
        slot.freezeUntil = 0
      }
      slot.seen = this.frame
      const poseTime = now < slot.freezeUntil ? slot.frozeAt : now
      const focus = run.tutorialTarget === enemy
      this.actor(slot.image, enemy, point, poseTime, counter === enemy, run, focus, wall)
      if (focus) {
        const image = slot.image
        this.tutorialFocus = {
          x: image.x / width, y: (image.y - image.displayHeight * 0.52) / height,
          rx: (image.displayWidth * 0.60 + 14) / width, ry: (image.displayHeight * 0.62 + 24) / height,
        }
      }
    }
    for (const slot of this.slots) if (slot.seen !== this.frame && slot.id) {
      slot.id = 0
      slot.image.setVisible(false)
    }

    this.drawParticles(projector, now)
    const hurt = Math.max(0, 1 - (wall - this.hurtAt) / 0.30)
    if (hurt) {
      this.damageFrame.lineStyle(14, 0xff302c, hurt * 0.93).strokeRect(6, 6, width - 12, height - 12)
      this.damageFrame.lineStyle(8, 0xc82130, hurt * 0.30).strokeRect(16, 16, width - 32, height - 32)
    }
    const superPower = demo?.boost ?? run.runner.superBoost
    const dash = Math.min(1, (superPower || run.runner.dash) * 1.28)
    if ((run.active || demo) && dash > 0.06 && !(demo && this.reducedMotion.matches)) {
      for (let i = 0; i < (superPower > 0.10 ? 20 : 11); i++) {
        const side = i % 2 ? 1 : -1
        const travel = ((demo?.age ?? now) * (superPower ? 4.8 : 2.7) + i * 0.219) % 1
        const x = width / 2 + side * (width * (0.29 + travel * 0.25))
        const y = height * (0.21 + (i % 6) * 0.105 + travel * 0.15)
        if (superPower > 0.10) {
          this.effects.fillStyle(i % 3 ? 0xffd68a : 0xfff2c9, (1 - travel) * dash * 0.83)
          for (let pixel = 0; pixel < 4; pixel++) {
            this.effects.fillRect(Math.round(x + side * pixel * 7), Math.round(y + pixel * 4),
              7, i % 3 ? 2 : 3)
          }
        } else {
          this.effects.lineStyle(i % 3 === 0 ? 2 : 1, 0xffeac0, (1 - travel) * dash * 0.50)
            .lineBetween(x, y, x + side * (11 + travel * 34), y + 6 + travel * 15)
        }
      }
    }
    if (superPower > 0.1 && run.combat.build.rank('wave')) {
      const wave = projector.project(run.runner.x, projector.cameraZ + 2.4)
      this.effects.lineStyle(4, 0xffd26a, 0.44).strokeEllipse(wave.x, wave.y - 19, 210 * wave.scale, 19)
    }
    this.drawFists(run, width, height, wall, hurt, preview, demo)
    this.drawUppercut(run, projector, wall, preview, demo)
    if (preview && preview.type !== 'hero') {
      const demo = this.previewEnemy
      const age = (wall - preview.start) % 1.7
      demo.type = preview.type
      demo.pose = preview.pose as EnemyPose
      demo.since = -age
      demo.until = 0.6 - age
      demo.y = demo.pose === 'airborne' || demo.pose === 'finish' ? Math.sin(age / 1.7 * Math.PI) * 1.6 : 0
      demo.hp = demo.pose === 'fall' || demo.pose === 'defeated' ? 0 : 100
      this.actor(this.previewImage, demo, projector.project(projector.cameraX, projector.cameraZ + 2.4), 0,
        demo.pose === 'telegraph' && age > 0.5, run)
      this.previewImage.setDepth(0)
    }
  }

  private newSlot(): Slot {
    return { image: this.assets.image('thug').setVisible(false), id: 0, seen: -1, freezeUntil: 0, frozeAt: 0 }
  }

  private actor(image: Phaser.GameObjects.Image, enemy: Enemy, point: ReturnType<PerspectiveProjector['project']>,
    now: number, counter: boolean, run: ParkRun, focus = false, wall = 0) {
    const { type } = enemy
    const pose = enemy.dashPushed ? 'dashPushed' : enemy.pose
    const age = Math.max(0, now - enemy.since)
    const moving = pose === 'approach' || pose === 'positioning' || pose === 'retreat'
    const gait = Math.sin(age * (type === 'quick' ? 19 : 13))
    const pulse = Math.sin(Math.min(1, age / 0.18) * Math.PI)
    const fall = pose === 'fall' ? Math.min(1, age / 0.56) : pose === 'defeated' ? 1 : 0
    const scale = Math.min(1.34, point.scale * (type === 'bulldog' ? 1.30 : 1.04))
    let rotation = moving ? gait * 0.065 : 0
    let stretchX = 1
    let stretchY = 1 + (moving ? Math.abs(gait) * 0.052 : Math.sin(now * 5 + enemy.id) * 0.019)
    let x = point.x
    let y = point.y - enemy.y * scale * 49
    if (pose === 'dashPushed') {
      rotation = -0.14 + (this.reducedMotion.matches ? 0 : Math.sin(now * 17 + enemy.id) * 0.025)
      stretchY = 0.88
      stretchX = 1.07
      y += (this.reducedMotion.matches ? 0 : Math.abs(Math.sin(now * 14 + enemy.id)) * 2) * scale
    } else if (pose === 'telegraph' || pose === 'laneTell') {
      stretchY *= 1 - Math.min(1, age * 6) * 0.12
      rotation = pose === 'laneTell' ? Math.sign(enemy.destination - enemy.lane) * 0.16 : -0.085
    } else if (pose === 'attack') {
      stretchX += pulse * 0.24
      stretchY += pulse * 0.20
      rotation = pulse * 0.15
      y += pulse * 11 * scale
    } else if (pose === 'sideFlight' || pose === 'knockback' || pose === 'hit' || pose === 'airborne') {
      rotation = (Math.sign(enemy.vx) || 1) * (pose === 'airborne' ? age * 1.9 : Math.max(0.10, 0.46 - age * 0.45))
      stretchX += Math.max(0, 1 - age * 8) * 0.20
      stretchY -= Math.max(0, 1 - age * 8) * 0.11
    } else if (pose === 'retreat' && type === 'bulldog') {
      const leap = Math.sin(Math.min(1, age / 0.55) * Math.PI)
      y -= leap * 40 * scale
      rotation = -leap * 0.18
    } else if (pose === 'stunned') {
      rotation = Math.sin(age * 25) * 0.12
      x += Math.sin(age * 28) * 3 * scale
    } else if (pose === 'recovery') stretchY -= Math.max(0, 1 - age * 4) * 0.11
    else if (pose === 'rage') {
      rotation = Math.sin(age * 36) * 0.075
      stretchX += Math.sin(age * 14) * 0.13
    } else if (pose === 'finish') rotation = age * 5.8
    if (fall) {
      rotation = (enemy.id % 2 ? 1 : -1) * fall * 1.47
      stretchY *= 1 - fall * 0.25
    }
    this.assets.pose(image, type, pose, age)
    this.assets.place(image, type, x, y, scale * stretchX, scale * stretchY)
    image.setVisible(true).setDepth(-point.distance * 10)
      .setAlpha((1 - fall * 0.96) * (pose === 'finish' ? Math.max(0.15, 1 - age * 1.4) : 1))
      .setRotation(rotation)
    this.shadows.fillStyle(0x342921, 0.30 * (1 - fall) / (1 + enemy.y))
      .fillEllipse(point.x, point.y + 1, 67 * scale, 14 * scale)
    if (enemy.hp <= 0) return
    const top = y - image.displayHeight - 7
    if (focus) {
      const alpha = 0.62 + (this.reducedMotion.matches ? 0 : Math.sin(wall * 5) * 0.14)
      this.marks.lineStyle(2, 0xff7f43, alpha).strokeRoundedRect(
        x - image.displayWidth * 0.46, y - image.displayHeight * 0.90,
        image.displayWidth * 0.92, image.displayHeight * 0.90, 12)
    }
    if (pose === 'telegraph') this.warning(x, top, counter,
      enemy.until - run.now <= run.balance.idealWindow, focus ? 1.40 + (this.reducedMotion.matches ? 0 : Math.sin(wall * 6) * 0.14) : 1)
    if (pose === 'laneTell') {
      const side = Math.sign(enemy.destination - enemy.lane)
      this.marks.fillStyle(0x272622).fillCircle(x, top, 10)
      this.marks.fillStyle(0x88e8dd).fillTriangle(x - side * 4, top - 5, x + side * 6, top, x - side * 4, top + 5)
    }
    if (pose === 'stunned' || pose === 'rage') {
      const color = pose === 'rage' ? colors.rage : 0xffd765
      this.marks.fillStyle(color)
      for (let i = -1; i <= 1; i++) this.marks.fillCircle(x + i * 9, top + Math.sin(age * 15 + i) * 3, 2.3)
    }
    if (enemy.burnTicks) {
      for (let i = 0; i < 5; i++) {
        const life = (now * 3 + i * 0.22) % 1
        this.effects.fillStyle(i % 2 ? 0xffc15d : 0xff6a38, 0.9 * (1 - life))
          .fillRect(x + (i - 2) * 8 * scale, y - image.displayHeight * 0.40 - life * 42 * scale, 4, 6)
      }
    }
  }

  private drawFists(run: ParkRun, width: number, height: number, wall: number, hurt: number, preview?: AnimationPreview, demo?: TutorialDemo) {
    const now = run.visualTime
    if (run.phase === 'defeat' && this.defeatAt === -Infinity) this.defeatAt = wall
    const knockout = Math.max(0, Math.min(1, (wall - this.defeatAt) / 0.5))
    const demoAge = preview?.type === 'hero' ? (wall - preview.start) % 0.85 : 0
    const demoHurt = preview?.type === 'hero' && preview.pose === 'hurt' ? Math.max(0, 1 - demoAge * 3) : hurt
    const bump = preview || demo ? 0 : this.bodyRecoil(wall)
    const fall = run.phase === 'defeat' ? knockout : preview?.type === 'hero' && preview.pose === 'knockout' ?
      Math.min(1, demoAge / 0.52) : 0
    const uppercut = run.combat.uppercutStrike
    const timing = run.runner.uppercut?.profile ?? uppercutTiming(run.balance)
    const dashTiming = superTiming(run.balance)
    const dashAge = demo ? demo.superAge : run.runner.superActive ? run.runner.superAge : undefined
    for (const hand of hands) {
      const image = this.fists[hand]
      const side = hand === 'left' ? -1 : 1
      const latest = run.combat.strike
      const ordinary = latest?.hand === hand && latest.kind !== 'uppercut' &&
        (dashAge === undefined || latest.at >= now - dashAge - 1e-9) ? latest : undefined
      const rising = uppercut?.hand === hand && (run.runner.uppercut?.age ?? now - uppercut.at) < timing.duration ? uppercut : undefined
      let strike: Strike | undefined = ordinary && (!rising || ordinary.at > rising.at) &&
        now - ordinary.at < this.strikeDuration(ordinary.kind, run) ? ordinary : rising
      let age = strike === uppercut && run.runner.uppercut ? run.runner.uppercut.age : strike ? now - strike.at : 1
      let superAge = dashAge
      let pose: HandPose = run.active ? run.runner.dash > 0.3 ? 'dash' : 'run' : 'idle'
      if (demo) {
        strike = demo.strike?.hand === hand ? demo.strike : undefined
        age = strike ? -strike.at : 1
      }
      if (preview?.type === 'hero') {
        pose = preview.pose as HandPose
        const elapsed = (wall - preview.start) % (pose === 'superDash' ? dashTiming.duration + 0.45 : 0.9)
        strike = undefined
        superAge = pose === 'superDash' ? elapsed : undefined
        if (pose === 'punch' || pose === 'uppercut' || pose === 'sideLeft' ||
          pose === 'sideRight' || pose === 'counter' || pose === 'finish') {
          strike = { hand, kind: pose, at: now, aim: 0, hit: true }
          age = hand === (pose === 'sideLeft' ? 'left' : 'right') ? elapsed : 2
        }
      }
      const profile = preview || demo ? uppercutTiming(run.balance) : timing
      const duration = strike?.kind === 'uppercut' ? profile.duration : strike ? this.strikeDuration(strike.kind, run) : 1
      if (age >= duration) strike = undefined
      const kind = strike?.kind
      const lateral = kind === 'sideLeft' ? -1 : kind === 'sideRight' ? 1 : 0
      const time = Math.min(1, Math.max(0, age / duration))
      const extension = strike ? Math.sin(time ** 0.61 * Math.PI) : 0
      const powered = !strike && superAge !== undefined && superAge < dashTiming.duration
      const thrust = powered ? superHandMotion(superAge!, run.balance) : 0
      const sample = uppercutFrame(age, profile)
      const risingMotion = kind === 'uppercut' ? sample.hand : 0
      if (powered) pose = 'superDash'
      if (strike) pose = strike.kind
      if (demoHurt > 0.60) pose = 'hurt'
      if (fall > 0) pose = 'knockout'
      const bob = Math.sin((preview?.type === 'hero' ? wall : now) * (pose === 'dash' ? 15 : 9) + side * 1.2) *
        (pose === 'dash' ? 10 : pose === 'run' || run.active ? 6 : 2) *
        (1 - uppercutFrame(run.runner.uppercut?.age ?? (kind === 'uppercut' ? age : -1), profile).compression * 0.8)
      const aim = strike ? Math.max(-45, Math.min(45, strike.aim * 25)) : 0
      const x = width / 2 - this.bodySide * 8 * bump + side * (102 + fall * 24 + thrust * 10) + (lateral
        ? lateral * (-98 + time * 198) * extension : kind === 'uppercut'
          ? (aim - side * 35) * Math.max(0, risingMotion) : (aim - side * (kind === 'finish' ? 120 : 92)) * extension)
      const lift = powered ? thrust * 0.27 : kind === 'uppercut' ? risingMotion * 0.46 :
        lateral ? extension * 0.14 : extension * 0.31
      const y = height - 103 + bob - lift * height + fall * 122 + demoHurt * 17 + bump * 8
      const scale = powered ? 1 + thrust * 0.28 : kind === 'uppercut' ?
        1 + Math.min(0, risingMotion) * 0.31 - Math.max(0, risingMotion) * 0.18 :
        1 - extension * 0.33 + (kind === 'counter' ? extension * 0.12 : 0)
      const id = hand === 'left' ? 'fist.left' : 'fist.right'
      this.assets.pose(image, id, pose, powered ? superAge! : strike ? age : now)
      this.assets.place(image, id, x, y, scale)
      image.setRotation(-this.bodySide * bump * 0.06 + side * (0.11 + fall * 0.6 + demoHurt * 0.24 - thrust * 0.16) +
        extension * side * (kind === 'counter' ? -0.24 : kind === 'uppercut' ? -0.52 : lateral ? -0.78 : -0.10))
    }
  }

  private drawUppercut(run: ParkRun, projector: PerspectiveProjector, wall: number, preview?: AnimationPreview, demo?: TutorialDemo) {
    const state = run.runner.uppercut
    const age = demo ? demo.kind === 'uppercut' && demo.strike ? -demo.strike.at : -1 :
      preview ? preview.type === 'hero' && preview.pose === 'uppercut' ? (wall - preview.start) % 0.9 : -1 : state?.age ?? -1
    const p = preview || demo ? uppercutTiming(run.balance) : state?.profile ?? uppercutTiming(run.balance)
    const frame = uppercutFrame(age, p)
    if (!frame.wave || frame.reach < 0.05) return
    const hand = demo?.strike?.hand ?? (preview ? 'right' : run.combat.uppercutStrike?.hand) ?? 'left'
    const fist = this.fists[hand]
    const lane = laneX(laneAt(run.runner.x))
    const cameraZ = projector.cameraZ
    const left = projector.project(lane - route.laneWidth * 0.45, cameraZ + frame.reach)
    const right = projector.project(lane + route.laneWidth * 0.45, cameraZ + frame.reach)
    const tip = projector.project(lane, cameraZ + frame.reach)
    const nearLeft = projector.project(lane - route.laneWidth * 0.45, cameraZ + 0.1)
    const nearRight = projector.project(lane + route.laneWidth * 0.45, cameraZ + 0.1)
    const x = Math.max(nearLeft.x, Math.min(nearRight.x, fist.x))
    const y = fist.y + 22 * tip.scale
    const top = tip.y - (118 + frame.progress * 28) * tip.scale
    const g = this.upperWave, alpha = frame.wave
    const base = tip.y - 12 * tip.scale
    const arc = () => {
      for (let i = 0; i <= 12; i++) {
        const t = i / 12
        g.lineTo(left.x + (right.x - left.x) * t, base - Math.sin(t * Math.PI) * (base - top))
      }
    }
    if (!this.reducedMotion.matches) {
      g.fillStyle(0xffcd79, 0.09 * alpha).beginPath().moveTo(x, y)
      arc()
      g.closePath().fillPath()
      g.lineStyle(3, 0xffdc9c, 0.28 * alpha).lineBetween(fist.x, fist.y + 22, fist.x - 5, fist.y + 44)
      const road = projector.project(lane, cameraZ + 0.65)
      for (let i = 0; i < 4; i++) {
        const offset = (i - 1.5) * 9 * road.scale
        g.lineStyle(2, 0xe6c68c, alpha * 0.35).lineBetween(road.x + offset, road.y,
          road.x + offset * 1.3, road.y - (4 + i % 2 * 5) * road.scale)
      }
    }
    g.lineStyle(2, 0xffedbc, 0.82 * alpha).beginPath().moveTo(left.x, base)
    arc()
    g.strokePath()
  }

  private strikeDuration(kind: Strike['kind'], run: ParkRun) {
    return kind === 'finish' ? 0.42 : kind === 'uppercut' ? uppercutTiming(run.balance).duration :
      kind === 'sideLeft' || kind === 'sideRight' ? 0.18 : Math.min(0.23, run.combat.punchInterval)
  }

  private warning(x: number, y: number, counter: boolean, ideal: boolean, scale = 1) {
    const color = counter ? ideal ? 0xfff0a5 : 0xffcf4c : 0xff594b
    const radius = (counter ? 12 : 10) * scale
    if (scale > 1) this.warnings.fillStyle(0xffcf4c, 0.30).fillCircle(x, y, radius + 5)
    this.warnings.fillStyle(0x272423).fillCircle(x, y, radius)
    this.warnings.lineStyle((counter && ideal ? 3 : 2) * scale, color).strokeCircle(x, y, radius)
    this.warnings.fillStyle(color).fillRect(x - 2 * scale, y - 6 * scale, 4 * scale, 8 * scale)
      .fillCircle(x, y + 5 * scale, 2 * scale)
  }

  private drawParticles(projector: PerspectiveProjector, now: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const effect = this.particles[i]
      const shove = effect.kind === 'bodyContact' || effect.kind === 'bodyShove' || effect.kind === 'dashImpact'
      const life = shove ? 0.22 : effect.kind === 'finish' || effect.kind === 'rage' ? 0.60 : effect.kind === 'level' ? 0.48 : 0.33
      const progress = (now - effect.at) / life
      if (progress >= 1) { this.particles.splice(i, 1); continue }
      const point = projector.project(effect.x, effect.z)
      const alpha = (1 - progress) * 0.9
      const color = colors[effect.kind]
      if (effect.kind === 'level') {
        this.effects.lineStyle(3, color, alpha * 0.48).strokeRect(5, 5, projector.width - 10, projector.height - 10)
        continue
      }
      if (shove) {
        const dash = effect.kind === 'dashImpact'
        const graphics = dash ? this.dashFlashes : this.effects
        const direction = effect.direction ?? 1
        const falloff = Math.max(0, Math.min(1, (0.55 - point.distance) / 0.55))
        if (effect.kind === 'bodyShove' && point.distance < 0) continue
        const nearX = projector.width * (0.5 + direction * (dash ? 0.18 : 0.21))
        const x = point.x + (nearX - point.x) * falloff
        const worldY = point.y - Math.min(100, 80 * point.scale)
        const y = worldY + (projector.height * (dash ? 0.69 : 0.78) - worldY) * falloff
        const travel = (dash ? 50 : 36) * (0.32 + progress)
        graphics.lineStyle(dash ? 3 : 2, color, alpha)
        for (let ray = -2; ray <= 2; ray++) {
          const dx = travel * (1 - Math.abs(ray) * 0.13)
          graphics.lineBetween(x + direction * dx * 0.35, y + ray * 5,
            x + direction * dx, y + ray * (7 + progress * 12))
        }
        graphics.fillStyle(dash ? 0xffefbc : color, alpha * (1 - progress))
          .fillRect(x - 3, y - 3, dash ? 8 : 5, dash ? 8 : 5)
        continue
      }
      if (point.distance < -2) continue
      const y = effect.kind === 'landing' ? point.y : point.y - Math.min(100, 80 * point.scale)
      if (effect.kind === 'electric' && effect.fromX !== undefined && effect.fromZ !== undefined) {
        const from = projector.project(effect.fromX, effect.fromZ)
        let px = from.x
        let py = from.y - Math.min(100, 80 * from.scale)
        this.effects.lineStyle(2.8, color, alpha)
        for (let segment = 1; segment <= 5; segment++) {
          const t = segment / 5
          const nx = from.x + (point.x - from.x) * t
          const ny = from.y - Math.min(100, 80 * from.scale) +
            (y - (from.y - Math.min(100, 80 * from.scale))) * t + (segment === 5 ? 0 : (segment % 2 ? 8 : -8))
          this.effects.lineBetween(px, py, nx, ny)
          px = nx
          py = ny
        }
        continue
      }
      const radius = (effect.kind === 'finish' ? 95 : effect.kind === 'air' ? 65 : effect.kind === 'ricochet' ? 52 :
        effect.kind === 'wave' || effect.kind === 'landing' ? 44 :
        effect.kind === 'miss' ? 15 : 27) * (0.4 + progress * 1.1)
      this.effects.lineStyle(effect.kind === 'miss' ? 1 : 2.5, color, effect.kind === 'miss' ? alpha * 0.32 : alpha)
        .strokeEllipse(point.x, y, radius * 1.30, effect.kind === 'wave' || effect.kind === 'landing' ? radius * 0.36 : radius)
      if (effect.kind === 'miss' || effect.kind === 'fire') continue
      for (let ray = 0; ray < 7; ray++) {
        const angle = ray * 6.283 / 7 + progress * 0.3
        const dx = Math.cos(angle) * radius
        const dy = Math.sin(angle) * radius
        this.effects.lineBetween(point.x + dx * 0.61, y + dy * 0.61, point.x + dx, y + dy)
      }
    }
  }

  private drawZones(run: ParkRun, projector: PerspectiveProjector) {
    const base = run.runner.z + 0.08
    const front = run.runner.z + run.balance.reach
    for (const x of [-route.halfWidth, -route.laneWidth / 2, route.laneWidth / 2, route.halfWidth]) {
      const near = projector.project(x, base)
      const far = projector.project(x, run.runner.z + 20)
      this.marks.lineStyle(1, 0x8af8ea, 0.65).lineBetween(near.x, near.y, far.x, far.y)
    }
    const near = projector.project(run.runner.x, base)
    const far = projector.project(run.runner.x, front)
    this.marks.lineStyle(2, 0x9af9df, 0.9).strokeEllipse(far.x, far.y, 80 * far.scale, 16 * far.scale)
      .strokeEllipse(near.x, near.y - 12, 80 * near.scale, 13 * near.scale)
    for (const enemy of run.combat.enemies) {
      const point = projector.project(enemy.x, enemy.z)
      if (point.visible && enemy.hp > 0) this.marks.strokeEllipse(point.x, point.y, 60 * point.scale, 12 * point.scale)
    }
  }
}

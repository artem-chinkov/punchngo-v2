import Phaser from 'phaser'
import { AssetRegistry } from '../assets/AssetRegistry'
import { defaultBalance } from '../combat/balance'
import { BalancePanel } from '../debug/BalancePanel'
import { TouchController } from '../input/TouchController'
import { CombatView } from '../rendering/CombatView'
import { ParkView } from '../rendering/ParkView'
import { PerspectiveProjector } from '../rendering/PerspectiveProjector'
import { HUD } from '../ui/HUD'
import { defaultWorld } from '../world/route'
import { FrameClock } from './FrameClock'
import { ParkRun } from './ParkRun'
import { readRecords, recordResult } from './records'

const landscape = matchMedia('(orientation: landscape) and (pointer: coarse)')
const query = new URLSearchParams(location.search)

export class ParkScene extends Phaser.Scene {
  private assets!: AssetRegistry
  private park!: ParkView
  private combatView!: CombatView
  private run!: ParkRun
  private touch!: TouchController
  private hud!: HUD
  private debug?: BalancePanel
  private readonly clock = new FrameClock()
  private wall = 0
  private recorded = false
  private records = readRecords()

  preload() {
    this.assets = new AssetRegistry(this, query.get('assets') === 'raster' ? 'raster' : 'placeholder')
    this.assets.preload()
  }

  create() {
    this.assets.create()
    this.park = new ParkView(this, this.assets)
    this.combatView = new CombatView(this, this.assets)
    const root = document.querySelector<HTMLElement>('#ui')!
    this.hud = new HUD(root, () => this.restart(), id => { this.resetInput(); this.run.choose(id) })
    if (query.get('debug') === '1') this.debug = new BalancePanel(root, () => {
      this.resetInput()
      this.renderFrame()
    }, atBoss => this.restart(atBoss))
    this.run = this.createRun()
    this.touch = new TouchController(this.game.canvas, () => this.canInput(),
      () => { this.run.tap() }, direction => this.run.swipe(direction))
    landscape.addEventListener('change', this.resetInput)
    document.addEventListener('visibilitychange', this.resetInput)
    window.addEventListener('blur', this.resetInput)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      landscape.removeEventListener('change', this.resetInput)
      document.removeEventListener('visibilitychange', this.resetInput)
      window.removeEventListener('blur', this.resetInput)
      this.touch.destroy()
      root.replaceChildren()
    })
    this.renderFrame()
  }

  update(_time: number, delta: number) {
    if (document.hidden || landscape.matches) {
      this.clock.reset()
      return
    }
    const advancing = !this.debug?.open && !this.debug?.preview &&
      (this.run.active || this.run.phase === 'finisher')
    this.wall += this.clock.frame(delta, this.debug?.speed ?? 1, advancing ? this.tick : undefined)
    if (this.run.finished && !this.recorded) {
      this.recorded = true
      if (!this.debug) this.records = recordResult(this.run.result())
    }
    this.renderFrame()
  }

  private tick = (step: number) => {
    this.run.update(step, this.debug?.invulnerable ?? false)
    const advancing = this.run.active || this.run.phase === 'finisher'
    if (!advancing) this.resetInput()
    return advancing
  }

  private resetInput = () => {
    this.touch?.cancel()
    this.run?.clearInput()
    this.clock.reset()
  }

  private canInput() {
    return this.run.active && !landscape.matches && !document.hidden && !this.debug?.open && !this.debug?.preview
  }

  private createRun() {
    const fixed = query.get('seed')
    const seed = this.debug?.seed ?? (fixed !== null && Number.isFinite(Number(fixed)) ? Number(fixed) >>> 0 :
      crypto.getRandomValues(new Uint32Array(1))[0])
    return new ParkRun(this.debug?.balance ?? defaultBalance, defaultWorld, seed)
  }

  private restart(atBoss = false) {
    this.resetInput()
    this.run = this.createRun()
    this.recorded = false
    if (atBoss) this.run.debugBoss()
    else this.run.start()
    this.hud.reset()
    this.combatView.reset()
    this.renderFrame()
  }

  private renderFrame() {
    const { width, height } = this.scale.gameSize
    const { combat, runner, world } = this.run
    const now = this.run.visualTime
    for (const event of combat.events) {
      this.combatView.show(event, now)
      this.hud.show(event, now)
    }
    combat.events.length = 0
    const projection = new PerspectiveProjector(width, height, runner.z, world, runner.x, runner.dash)
    this.park.draw(projection, world.viewDistance, Math.max(0, Math.min(1, (this.run.now - 80) / 65)))
    this.debug?.draw(this.run, this.game.loop.actualFps, this.wall)
    this.combatView.draw(this.run, projection, this.wall, this.debug?.zones ?? false, this.debug?.preview)
    this.hud.draw(this.run, this.records, !!this.debug?.preview)
  }
}

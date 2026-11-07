import Phaser from 'phaser'
import { AssetRegistry } from '../assets/AssetRegistry'
import { GameAudio } from '../audio/GameAudio'
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
  private audio!: GameAudio
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
    this.audio = new GameAudio(this)
    this.audio.load()
    this.hud = new HUD(root, () => { this.audio.unlock(); this.restart() }, id => {
      this.resetInput()
      this.run.choose(id)
    }, this.audio.settings, settings => this.audio.setSettings(settings))
    if (query.get('debug') === '1') this.debug = new BalancePanel(root, () => {
      this.resetInput()
      this.renderFrame()
    }, atBoss => { this.audio.unlock(); this.restart(atBoss) })
    this.run = this.createRun()
    this.touch = new TouchController(this.game.canvas, () => this.canInput(),
      () => { this.audio.unlock(); this.run.tap() }, direction => this.run.swipe(direction))
    this.visibilityChanged()
    landscape.addEventListener('change', this.visibilityChanged)
    document.addEventListener('visibilitychange', this.visibilityChanged)
    window.addEventListener('blur', this.resetInput)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      landscape.removeEventListener('change', this.visibilityChanged)
      document.removeEventListener('visibilitychange', this.visibilityChanged)
      window.removeEventListener('blur', this.resetInput)
      this.audio.resetRun()
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
    const advancing = !this.debug?.paused &&
      (this.run.active || this.run.phase === 'finisher')
    this.wall += this.clock.frame(delta, this.debug?.speed ?? 1, advancing ? this.tick : undefined)
    if (this.run.finished && !this.recorded) {
      this.recorded = true
      if (!this.debug) this.records = recordResult(this.run.result())
    }
    this.renderFrame(Math.min(delta / 1000, 0.05))
  }

  private tick = (step: number) => {
    this.run.update(step, this.debug?.invulnerable ?? false, this.touch.isHolding())
    const advancing = this.run.active || this.run.phase === 'finisher'
    if (!advancing) this.resetInput()
    return advancing
  }

  private resetInput = () => {
    this.touch?.cancel()
    this.hud?.cancelInput()
    this.run?.clearInput()
    this.clock.reset()
  }

  private visibilityChanged = () => {
    this.resetInput()
    this.audio.setForeground(!document.hidden && !landscape.matches)
  }

  private canInput() {
    return this.run.active && !landscape.matches && !document.hidden && !this.debug?.paused
  }

  private createRun() {
    const fixed = query.get('seed')
    const seed = this.debug?.seed ?? (fixed !== null && Number.isFinite(Number(fixed)) ? Number(fixed) >>> 0 :
      crypto.getRandomValues(new Uint32Array(1))[0])
    return new ParkRun(this.debug?.balance ?? defaultBalance, this.debug?.world ?? defaultWorld, seed)
  }

  private restart(atBoss = false) {
    this.resetInput()
    this.audio.resetRun()
    this.run = this.createRun()
    this.recorded = false
    if (atBoss) this.run.debugBoss()
    else this.run.start()
    this.hud.reset()
    this.combatView.reset()
    this.renderFrame()
  }

  private renderFrame(seconds = 0) {
    const { width, height } = this.scale.gameSize
    const { combat, runner, world } = this.run
    const now = this.run.visualTime
    for (const event of combat.events) {
      this.combatView.show(event, now, this.wall)
      this.hud.show(event, now)
    }
    combat.events.length = 0
    for (const cue of combat.audioCues) this.audio.play(cue)
    combat.audioCues.length = 0
    this.audio.update(this.run.phase, combat.boss?.bossPhase, seconds)
    const projection = new PerspectiveProjector(width, height, runner.z, world, runner.x, runner.dash)
    this.park.draw(projection, world.viewDistance, Math.max(0, Math.min(1, (this.run.now - 80) / 65)))
    this.debug?.draw(this.run, this.game.loop.actualFps, this.wall)
    this.combatView.draw(this.run, projection, this.wall, this.debug?.zones ?? false, this.debug?.preview)
    this.hud.draw(this.run, this.records, this.wall, !!(this.debug?.preview || this.debug?.cameraOpen))
  }
}

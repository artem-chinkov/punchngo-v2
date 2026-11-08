import Phaser from 'phaser'
import { AssetRegistry } from '../assets/AssetRegistry'
import { GameAudio } from '../audio/GameAudio'
import { defaultBalance } from '../combat/balance'
import { BalancePanel } from '../debug/BalancePanel'
import { TouchController, type InputMode } from '../input/TouchController'
import { CombatView } from '../rendering/CombatView'
import { ParkView } from '../rendering/ParkView'
import { PerspectiveProjector } from '../rendering/PerspectiveProjector'
import { TutorialOverlay } from '../ui/TutorialOverlay'
import { HUD } from '../ui/HUD'
import { defaultWorld } from '../world/route'
import { Onboarding, type TutorialStage } from './Onboarding'
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
  private tutorial!: TutorialOverlay
  private readonly onboarding = new Onboarding()
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
    }, this.audio.settings, settings => this.audio.setSettings(settings), this.replayTutorial)
    this.tutorial = new TutorialOverlay(root, () => {
      if (this.run.phase !== 'ready' || !this.onboarding.startCountdown(this.wall)) return
      this.audio.unlock()
      this.resetInput()
      this.renderFrame()
    }, () => this.finishTutorialCounter(true), () => this.finishTutorialCounter(false))
    if (query.get('debug') === '1') this.debug = new BalancePanel(root, () => {
      this.resetInput()
      this.renderFrame()
    }, atBoss => { this.audio.unlock(); this.restart(atBoss) }, this.replayTutorial)
    this.run = this.createRun()
    this.touch = new TouchController(this.game.canvas, () => this.inputMode(), mode => {
      this.audio.unlock()
      if (mode === 'counter') this.finishTutorialCounter(false)
      else this.run.tap()
    }, direction => {
      this.audio.unlock()
      if (direction === 'up' || direction === 'down') this.run.special(direction === 'up' ? 'hook' : 'uppercut')
      else this.run.swipe(direction === 'left' ? -1 : 1)
    })
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
    const advancing = !this.debug?.paused && !this.run.tutorialTarget &&
      (this.run.active || this.run.phase === 'finisher')
    this.wall += this.clock.frame(delta, this.debug?.speed ?? 1, advancing ? this.tick : undefined)
    if (this.onboarding.readyToRun(this.wall)) {
      this.resetInput()
      this.run.start()
      this.audio.play('ui.upgrade_select')
    }
    if (this.run.finished && !this.recorded) {
      this.recorded = true
      if (!this.debug) this.records = recordResult(this.run.result())
    }
    this.renderFrame(Math.min(delta / 1000, 0.05))
  }

  private tick = (step: number) => {
    const attacked = this.run.update(step, this.debug?.invulnerable ?? false, this.touch.hold(),
      this.onboarding.teachCounter)
    if (attacked) this.touch.acceptHold()
    const advancing = !this.run.tutorialTarget && (this.run.active || this.run.phase === 'finisher')
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

  private inputMode(): InputMode {
    if (!this.run.active || landscape.matches || document.hidden || this.debug?.paused) return 'off'
    return this.run.tutorialTarget ? 'counter' : 'play'
  }

  private replayTutorial = () => {
    this.onboarding.reset()
    this.restart(false, false)
  }

  private finishTutorialCounter(skip: boolean) {
    if (this.inputMode() !== 'counter' || !this.run.confirmTutorialCounter(skip)) return
    this.onboarding.finishCounter(this.wall, skip)
    this.resetInput()
    this.renderFrame()
  }

  private tutorialStage(): TutorialStage {
    if (this.run.tutorialTarget) return 'counter'
    if (this.run.phase === 'ready') {
      if (this.onboarding.showControls) return 'controls'
      if (this.onboarding.counting) return 'countdown'
    }
    return this.run.active && this.onboarding.showingSuccess(this.wall) ? 'success' : 'none'
  }

  private createRun() {
    const fixed = query.get('seed')
    const seed = this.debug?.seed ?? (fixed !== null && Number.isFinite(Number(fixed)) ? Number(fixed) >>> 0 :
      crypto.getRandomValues(new Uint32Array(1))[0])
    return new ParkRun(this.debug?.balance ?? defaultBalance, this.debug?.world ?? defaultWorld, seed)
  }

  private restart(atBoss = false, start = true) {
    this.onboarding.clearPresentation()
    this.resetInput()
    this.audio.resetRun()
    this.run = this.createRun()
    this.recorded = false
    if (atBoss) this.run.debugBoss()
    else if (start) this.run.start()
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
    const stage = this.tutorialStage()
    const teaching = stage !== 'none' && stage !== 'success'
    this.audio.update(this.run.phase, combat.boss?.bossPhase, seconds, stage === 'counter')
    const hookKick = combat.strike?.kind === 'hook' && combat.strike.hit ?
      Math.max(0, 1 - (now - combat.strike.at) / 0.14) * 0.62 : 0
    const projection = new PerspectiveProjector(width, height, runner.z, world, runner.x, runner.dash + hookKick)
    this.park.draw(projection, world.viewDistance, Math.max(0, Math.min(1, (this.run.now - 80) / 65)))
    this.debug?.setTutorialHidden(teaching)
    this.debug?.draw(this.run, this.game.loop.actualFps, this.wall)
    this.combatView.draw(this.run, projection, this.wall, this.debug?.zones ?? false, this.debug?.preview)
    this.hud.draw(this.run, this.records, this.wall, !!(this.debug?.preview || this.debug?.cameraOpen),
      teaching, stage === 'controls' || stage === 'countdown')
    this.tutorial.draw(stage, stage === 'countdown' ? this.onboarding.count(this.wall) : 0, this.combatView.tutorialFocus)
  }
}

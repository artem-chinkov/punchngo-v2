import type { UpgradeId } from '../game/upgrades'

const noticeDuration = 0.35
const lockDuration = 0.53

export class UpgradeReveal {
  private started = Infinity
  private press?: { card: UpgradeId; pointer: number }
  private released?: UpgradeId

  start(now: number) {
    this.started = now
    this.cancel()
  }

  stage(now: number) {
    if (now >= this.started + lockDuration) return 'ready'
    return now >= this.started + noticeDuration ? 'entering' : 'notice'
  }

  down(card: UpgradeId | undefined, pointer: number, now: number) {
    this.cancel()
    if (card && this.stage(now) === 'ready') this.press = { card, pointer }
  }

  up(card: UpgradeId | undefined, pointer: number) {
    if (this.press?.pointer !== pointer) return
    this.released = this.press.card === card ? card : undefined
    this.press = undefined
  }

  accept(card: UpgradeId, now: number, keyboard: boolean) {
    const fresh = keyboard || this.released === card
    this.cancel()
    return fresh && this.stage(now) === 'ready'
  }

  cancel() {
    this.press = undefined
    this.released = undefined
  }
}

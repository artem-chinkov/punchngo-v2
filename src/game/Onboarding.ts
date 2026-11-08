export interface TutorialProgress { controls: boolean; counter: boolean }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
export type TutorialStage = 'none' | 'controls' | 'countdown' | 'counter' | 'success'

const key = 'punchngo.v2.tutorial'
const empty = (): TutorialProgress => ({ controls: false, counter: false })

export function readTutorial(storage?: StoragePort): TutorialProgress {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(key) ?? '{}')
    return { controls: value?.controls === true, counter: value?.counter === true }
  } catch { return empty() }
}

export class Onboarding {
  private progress: TutorialProgress
  private countdownAt?: number
  private successUntil = -Infinity

  constructor(private readonly storage?: StoragePort) { this.progress = readTutorial(storage) }

  get showControls() { return !this.progress.controls && this.countdownAt === undefined }
  get teachCounter() { return !this.progress.counter }
  get counting() { return this.countdownAt !== undefined }

  reset() {
    this.progress = empty()
    this.countdownAt = undefined
    this.successUntil = -Infinity
    this.save()
  }

  clearPresentation() {
    this.countdownAt = undefined
    this.successUntil = -Infinity
  }

  startCountdown(wall: number) {
    if (!this.showControls) return false
    this.progress.controls = true
    this.countdownAt = wall
    this.save()
    return true
  }

  count(wall: number) {
    if (this.countdownAt === undefined) return 0
    const elapsed = wall - this.countdownAt - 0.18
    return elapsed < 0 ? 0 : Math.max(1, 3 - Math.floor(elapsed))
  }

  readyToRun(wall: number) {
    if (this.countdownAt === undefined || wall - this.countdownAt < 3.18) return false
    this.countdownAt = undefined
    return true
  }

  finishCounter(wall: number, skipped: boolean) {
    this.progress.counter = true
    this.successUntil = skipped ? -Infinity : wall + 0.72
    this.save()
  }

  showingSuccess(wall: number) { return wall < this.successUntil }

  private save() {
    try { (this.storage ?? localStorage).setItem(key, JSON.stringify(this.progress)) } catch { /* session only */ }
  }
}

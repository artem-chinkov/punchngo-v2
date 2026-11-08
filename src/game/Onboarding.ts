import type { LearnedAction } from '../combat/CombatSystem'
import { laneAt } from '../world/route'
import type { ParkRun } from './ParkRun'

export type HintKind = LearnedAction
export const hintKinds: readonly HintKind[] = ['punch', 'side', 'superDash', 'uppercut']
export type CounterProgress = 'pending' | 'complete' | 'skipped'
export interface TutorialProgress {
  version: 2
  controls: boolean
  counter: CounterProgress
  hints: HintKind[]
}

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
export type TutorialStage = 'none' | 'controls' | 'countdown' | 'counterLocked' | 'counterReady' | 'success'
const key = 'punchngo.v2.tutorial'
const empty = (): TutorialProgress => ({ version: 2, controls: false, counter: 'pending', hints: [] })
const hintDuration = 2.2
const hintGap = 6

export function readTutorial(storage?: StoragePort): TutorialProgress {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(key) ?? '{}')
    const counter = value?.counter
    return {
      version: 2,
      controls: value?.version === 2 && value?.controls === true,
      counter: counter === true || counter === 'complete' ? 'complete' : counter === 'skipped' ? 'skipped' : 'pending',
      hints: value?.version === 2 && Array.isArray(value.hints) ? hintKinds.filter(kind => value.hints.includes(kind)) : [],
    }
  } catch { return empty() }
}

export class Onboarding {
  private progress: TutorialProgress
  private countdownAt?: number
  private counterVisibleAt?: number
  private counterUnlocked = false
  private successUntil = -Infinity
  private controlsAt?: number
  private hintNextAt = 0
  private shownHint?: { kind: HintKind; until: number; forced: boolean }
  private forcedHint?: HintKind

  constructor(private readonly storage?: StoragePort) { this.progress = readTutorial(storage) }

  get showControls() { return !this.progress.controls && this.countdownAt === undefined }
  get teachCounter() { return this.progress.counter === 'pending' }
  get counting() { return this.countdownAt !== undefined }
  get counterReady() { return this.counterUnlocked }
  get hint() { return this.shownHint?.kind }

  reset() {
    this.progress = empty()
    this.clearPresentation()
    this.save()
  }

  clearPresentation() {
    this.countdownAt = this.controlsAt = this.counterVisibleAt = undefined
    this.counterUnlocked = false
    this.successUntil = -Infinity
    this.shownHint = undefined
    this.forcedHint = undefined
    this.hintNextAt = 0
  }

  demoAge(wall: number) {
    this.controlsAt ??= wall
    return Math.max(0, wall - this.controlsAt)
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

  counterFrame(wall: number, duration: number, contacts: boolean, entrance: number) {
    this.counterVisibleAt ??= wall + entrance
    const elapsed = wall - this.counterVisibleAt
    if (!this.counterUnlocked && elapsed + 1e-9 >= duration && !contacts) this.counterUnlocked = true
    return Math.max(0, Math.min(1, duration > 0 ? elapsed / duration : elapsed >= 0 ? 1 : 0))
  }

  finishCounter(wall: number, skipped: boolean) {
    if (!this.counterUnlocked) return false
    this.progress.counter = skipped ? 'skipped' : 'complete'
    this.counterVisibleAt = undefined
    this.counterUnlocked = false
    this.successUntil = skipped ? -Infinity : wall + 0.72
    this.save()
    return true
  }

  showingSuccess(wall: number) { return wall < this.successUntil }

  forceHint(kind: HintKind) { this.forcedHint = kind }

  updateHints(run: ParkRun, enabled: boolean, allowed: boolean) {
    const actions = run.combat.learnedActions
    for (const kind of actions) {
      if (this.hint === kind) this.shownHint = undefined
      this.completeHint(kind)
    }
    actions.clear()
    if (!allowed || run.phase !== 'park') { this.shownHint = undefined; return }
    if (this.forcedHint) {
      this.shownHint = { kind: this.forcedHint, until: run.now + hintDuration, forced: true }
      this.hintNextAt = run.now + hintGap
      this.forcedHint = undefined
      return
    }
    if (this.shownHint) {
      if (!enabled && !this.shownHint.forced) this.shownHint = undefined
      else if (run.now >= this.shownHint.until) {
        if (!this.shownHint.forced) this.completeHint(this.shownHint.kind)
        this.shownHint = undefined
      } else return
    }
    if (!enabled || run.now < this.hintNextAt || this.progress.hints.length === hintKinds.length) return
    const kind = hintKinds.find(candidate => !this.progress.hints.includes(candidate) && eligible(run, candidate))
    if (!kind) return
    this.shownHint = { kind, until: run.now + hintDuration, forced: false }
    this.hintNextAt = run.now + hintGap
  }

  private completeHint(kind: HintKind) {
    if (this.progress.hints.includes(kind)) return
    this.progress.hints.push(kind)
    this.save()
  }

  private save() {
    try { (this.storage ?? localStorage).setItem(key, JSON.stringify(this.progress)) } catch { /* session only */ }
  }
}

function eligible(run: ParkRun, kind: HintKind) {
  const { runner, combat, now } = run
  if ((kind === 'superDash' || kind === 'uppercut') && combat.specialRemaining(now) > 1e-9) return false
  const lane = laneAt(runner.x)
  for (const enemy of combat.enemies) {
    if (enemy.type === 'bulldog' || enemy.hp <= 0 || enemy.y > 0.2) continue
    const z = enemy.z - runner.z
    const other = laneAt(enemy.x)
    const dir = other - runner.lane
    if (kind === 'punch' && other === lane && z >= 4 && z <= 8) return true
    if (kind === 'side' && (dir === -1 || dir === 1) && runner.canChangeLane(dir) && z >= 4 && z <= 10) return true
    if (kind === 'uppercut' && other === lane && z >= 4 && z <= 9 && (enemy.type === 'brute' || enemy.maxHp >= 65)) return true
    if (kind === 'superDash' && other === lane && z >= 6 && z <= 16) {
      let group = 0
      for (const target of combat.enemies) {
        const distance = target.z - runner.z
        if (target.type !== 'bulldog' && target.hp > 0 && target.y <= 0.2 && distance >= 6 &&
          distance <= 16 && Math.abs(target.z - enemy.z) <= 2.5 && ++group >= 3) return true
      }
    }
  }
  return false
}

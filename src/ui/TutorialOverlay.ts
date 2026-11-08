import type { HintKind, TutorialStage } from '../game/Onboarding'
import type { TutorialFocus } from '../rendering/CombatView'

const arrow = '<svg aria-hidden="true" viewBox="0 0 32 32"><path d="M14 2h4v4h4v4h4v4h4v6h-8v10H10V20H2v-6h4v-4h4V6h4z"/></svg>'
const touch = '<svg aria-hidden="true" viewBox="0 0 44 44"><circle class="touch-ring" cx="20" cy="13" r="11"/><path d="M15 21V12a4 4 0 0 1 8 0v10l2-4h4l3 4 4 1 2 5-4 11H17L7 27l3-5 5 3z"/></svg>'
const card = (dir: string, title: string) => `
  <div class="gesture-guide gesture-guide--${dir}">
    <span class="gesture-arrow" aria-hidden="true">${arrow}</span>
    <div class="gesture-copy"><h3>${title}</h3></div>
  </div>`
const miniFist = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v3h3v9h-4v4H7v-4H3V8h2z" fill="#ffcb84"/><path d="M8 6v7m4-7v7m4-7v7" fill="none" stroke="#a66435" stroke-width="2"/></svg>'
const hintCopy: Record<HintKind, string> = {
  punch: touch + '<b>ТАП / УДЕРЖАНИЕ</b><span class="hint-punches">' + miniFist + miniFist + '</span>',
  side: '<b>← БОКОВОЙ УДАР →</b>',
  superDash: '<b>↑ СУПЕР-РЫВОК</b>',
  uppercut: '<b>↓ АППЕРКОТ</b>',
}
export const counterEntranceSeconds = 0.2

export class TutorialOverlay {
  private readonly root = document.createElement('div')
  private readonly count: HTMLOutputElement
  private readonly controls: HTMLElement
  private readonly startButton: HTMLButtonElement
  private readonly skipButton: HTMLButtonElement
  private readonly counterPanel: HTMLElement
  private readonly hintPanel: HTMLElement
  private stage: TutorialStage = 'none'
  private hint?: HintKind
  private skipPointer?: number
  private releasedSkip?: number
  private counterKey?: { value: string; skip: boolean }

  constructor(parent: HTMLElement, start: () => void, skip: () => void, counter: () => void) {
    this.root.className = 'tutorial-layer'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="tutorial-shade" aria-hidden="true"></div>
      <section class="controls-tutorial" aria-labelledby="tutorial-title" hidden>
        <h2 class="tutorial-heading" id="tutorial-title">КАК ДРАТЬСЯ</h2>
        <div class="gesture-grid">
          ${card('up', 'СУПЕР-РЫВОК')}
          ${card('left', 'БОКОВОЙ УДАР')}
          <div class="gesture-center">${touch}<h3>ТАП / УДЕРЖАНИЕ</h3></div>
          ${card('right', 'БОКОВОЙ УДАР')}
          ${card('down', 'АППЕРКОТ')}
        </div>
        <button class="tutorial-start" data-tutorial-go type="button">В БОЙ!</button>
      </section>
      <output class="tutorial-count" aria-live="polite" hidden></output>
      <section class="counter-tutorial" aria-labelledby="counter-tutorial-title" tabindex="-1" hidden>
        <h2 class="tutorial-heading" id="counter-tutorial-title">КОНТРАТАКА!</h2>
        <div class="counter-lesson">
          <div class="counter-signs"><b class="lesson-red">КРАСНЫЙ !</b><span aria-hidden="true">→</span><b class="lesson-yellow">ЖЁЛТЫЙ !</b></div>
          <div class="counter-tap"><span class="counter-ring">${touch}</span><b>ТАП — КОНТРАТАКА!</b></div>
          <button type="button" data-tutorial-skip disabled>Пропустить</button>
        </div>
      </section>
      <div class="tutorial-success" role="status" hidden>ОТЛИЧНО!</div>
      <aside class="context-hint" aria-live="polite" hidden></aside>
    `
    parent.append(this.root)
    this.count = this.root.querySelector('.tutorial-count')!
    this.controls = this.root.querySelector('.controls-tutorial')!
    this.startButton = this.root.querySelector('[data-tutorial-go]')!
    this.skipButton = this.root.querySelector('[data-tutorial-skip]')!
    this.counterPanel = this.root.querySelector('.counter-tutorial')!
    this.hintPanel = this.root.querySelector('.context-hint')!
    this.startButton.addEventListener('click', start)
    this.skipButton.addEventListener('pointerdown', event => {
      this.releasedSkip = undefined
      if (this.stage === 'counterReady' && event.isPrimary && event.button === 0) this.skipPointer = event.pointerId
    })
    this.skipButton.addEventListener('pointerup', event => {
      this.releasedSkip = event.pointerId === this.skipPointer ? event.pointerId : undefined
      this.skipPointer = undefined
    })
    this.skipButton.addEventListener('pointercancel', this.cancelInput)
    this.skipButton.addEventListener('click', event => {
      const fromPointer = event.detail > 0 || (event instanceof PointerEvent && !!event.pointerType)
      const validPointer = this.releasedSkip !== undefined &&
        (!(event instanceof PointerEvent) || event.pointerId === this.releasedSkip)
      this.cancelInput()
      if (this.stage === 'counterReady' && (fromPointer ? validPointer : event.isTrusted)) skip()
    })
    this.counterPanel.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (this.stage === 'counterReady' && !event.repeat) {
        this.counterKey = { value: event.key, skip: event.target === this.skipButton }
      }
    })
    this.counterPanel.addEventListener('keyup', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      const key = this.counterKey
      this.counterKey = undefined
      if (this.stage === 'counterReady' && key?.value === event.key) (key.skip ? skip : counter)()
    })
  }

  cancelInput = () => {
    this.skipPointer = this.releasedSkip = undefined
    this.counterKey = undefined
  }

  draw(stage: TutorialStage, count: number, focus?: TutorialFocus, demo?: HintKind, hint?: HintKind, progress = 0) {
    const counter = stage === 'counterLocked' || stage === 'counterReady'
    this.root.hidden = stage === 'none' && !hint
    if (stage !== this.stage) {
      const entered = counter && this.stage !== 'counterLocked' && this.stage !== 'counterReady'
      this.stage = stage
      this.root.dataset.stage = stage
      this.startButton.disabled = stage !== 'controls'
      this.counterPanel.hidden = !counter
      this.skipButton.disabled = stage !== 'counterReady'
      this.root.querySelector<HTMLElement>('.tutorial-success')!.hidden = stage !== 'success'
      this.cancelInput()
      if (entered) this.counterPanel.focus({ preventScroll: true })
    }
    if (hint !== this.hint) {
      this.hint = hint
      this.hintPanel.hidden = !hint
      this.hintPanel.innerHTML = hint ? hintCopy[hint] : ''
    }
    if (demo && demo !== this.root.dataset.demo) this.root.dataset.demo = demo
    this.controls.hidden = stage !== 'controls' && !(stage === 'countdown' && !count)
    const digit = count ? String(count) : ''
    if (digit !== this.count.value) this.count.value = digit
    this.count.hidden = stage !== 'countdown' || !count
    if (counter) this.counterPanel.style.setProperty('--counter-progress', String(progress))
    if (counter && focus) {
      this.root.style.setProperty('--target-x', `${focus.x * 100}%`)
      this.root.style.setProperty('--target-y', `${focus.y * 100}%`)
      this.root.style.setProperty('--target-rx', `${focus.rx * 100}%`)
      this.root.style.setProperty('--target-ry', `${focus.ry * 100}%`)
      const spaceLeft = focus.x - focus.rx
      const spaceRight = 1 - focus.x - focus.rx
      const freeSide = Math.max(spaceLeft, spaceRight)
      const layout = freeSide >= 0.39 ? 'side' : focus.y >= 0.5 ? 'top' : 'bottom'
      this.root.dataset.side = spaceRight > spaceLeft ? 'right' : 'left'
      this.root.dataset.layout = layout
      this.root.style.setProperty('--counter-panel-width', `${Math.min(47, freeSide * 100 - 2)}%`)
    }
  }
}

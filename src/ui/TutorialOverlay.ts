import type { TutorialStage } from '../game/Onboarding'
import type { TutorialFocus } from '../rendering/CombatView'

const arrow = '<svg aria-hidden="true" viewBox="0 0 32 32"><path d="M14 2h4v4h4v4h4v4h4v6h-8v10H10V20H2v-6h4v-4h4V6h4z"/></svg>'
const touch = '<svg aria-hidden="true" viewBox="0 0 44 44"><circle class="touch-ring" cx="20" cy="13" r="11"/><path d="M15 21V12a4 4 0 0 1 8 0v10l2-4h4l3 4 4 1 2 5-4 11H17L7 27l3-5 5 3z"/></svg>'
const card = (dir: string, title: string, description: string, compact: string) => `
  <div class="gesture-guide gesture-guide--${dir}">
    <span class="gesture-arrow" aria-hidden="true">${arrow}</span>
    <div class="gesture-copy"><h3>${title}</h3><p>${description}</p><p class="gesture-compact">${compact}</p></div>
  </div>`

export class TutorialOverlay {
  private readonly root = document.createElement('div')
  private readonly count: HTMLOutputElement
  private readonly controls: HTMLElement
  private readonly startButton: HTMLButtonElement
  private stage: TutorialStage = 'none'

  constructor(parent: HTMLElement, start: () => void, skip: () => void, counter: () => void) {
    this.root.className = 'tutorial-layer'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="tutorial-shade" aria-hidden="true"></div>
      <section class="controls-tutorial" aria-labelledby="tutorial-title" hidden>
        <h2 class="tutorial-heading" id="tutorial-title">КАК ДРАТЬСЯ</h2>
        <div class="gesture-grid">
          ${card('up', 'СВАЙП ВВЕРХ — ХУК', 'Мощный размашистый удар. Поражает нескольких врагов.', 'Широкий удар по группе.')}
          ${card('left', 'СВАЙП ВЛЕВО — БОКОВОЙ УДАР', 'Перемещение влево с ударом по двум соседним полосам.', 'Сдвиг и удар по двум полосам.')}
          <div class="gesture-center">
            ${touch}
            <h3>ТАП</h3><p>Удар и рывок вперёд.</p><p class="gesture-compact">Удар и рывок.</p>
            <hr><h3>УДЕРЖАНИЕ</h3><p>Непрерывная серия ударов.</p><p class="gesture-compact">Серия ударов.</p>
          </div>
          ${card('right', 'СВАЙП ВПРАВО — БОКОВОЙ УДАР', 'Перемещение вправо с ударом по двум соседним полосам.', 'Сдвиг и удар по двум полосам.')}
          ${card('down', 'СВАЙП ВНИЗ — АППЕРКОТ', 'Подбрасывает противника вверх и временно выводит его из боя.', 'Подбрасывает врага.')}
        </div>
        <button class="tutorial-start" data-tutorial-go type="button">ПОНЯТНО, В БОЙ! <span aria-hidden="true">»</span></button>
      </section>
      <output class="tutorial-count" aria-live="polite" hidden></output>
      <section class="counter-tutorial" aria-labelledby="counter-tutorial-title" hidden>
        <h2 class="tutorial-heading" id="counter-tutorial-title">КОНТРАТАКА!</h2>
        <div class="counter-lesson">
          <div><span class="lesson-red" aria-hidden="true">!</span><p><b>КРАСНЫЙ !</b> Враг готовит удар.</p></div>
          <div><span class="lesson-yellow" aria-hidden="true">!</span><p><b>ЖЁЛТЫЙ !</b> Самое время контратаковать!</p></div>
          <div>${touch}<p><b>ТАП — КОНТРАТАКА!</b> Нажми, когда знак станет жёлтым, чтобы прервать атаку врага.</p></div>
          <button type="button" data-tutorial-skip>Пропустить</button>
        </div>
      </section>
      <div class="tutorial-success" role="status" hidden>ОТЛИЧНО!</div>
    `
    parent.append(this.root)
    this.count = this.root.querySelector('.tutorial-count')!
    this.controls = this.root.querySelector('.controls-tutorial')!
    this.startButton = this.root.querySelector('[data-tutorial-go]')!
    this.startButton.addEventListener('click', start)
    this.root.querySelector('[data-tutorial-skip]')!.addEventListener('click', skip)
    this.root.querySelector('.counter-tutorial')!.addEventListener('keydown', event => {
      const key = event as KeyboardEvent
      if (key.target instanceof HTMLButtonElement || key.repeat || (key.key !== 'Enter' && key.key !== ' ')) return
      key.preventDefault()
      counter()
    })
    this.root.querySelector<HTMLElement>('.counter-tutorial')!.tabIndex = -1
  }

  draw(stage: TutorialStage, count: number, focus?: TutorialFocus) {
    if (stage !== this.stage) {
      this.stage = stage
      this.root.hidden = stage === 'none'
      this.root.dataset.stage = stage
      this.startButton.disabled = stage !== 'controls'
      this.root.querySelector<HTMLElement>('.counter-tutorial')!.hidden = stage !== 'counter'
      this.root.querySelector<HTMLElement>('.tutorial-success')!.hidden = stage !== 'success'
      if (stage === 'counter') this.root.querySelector<HTMLElement>('.counter-tutorial')!.focus({ preventScroll: true })
    }
    this.controls.hidden = stage !== 'controls' && !(stage === 'countdown' && !count)
    const digit = count ? String(count) : ''
    if (digit !== this.count.value) this.count.value = digit
    this.count.hidden = stage !== 'countdown' || !count
    if (stage === 'counter' && focus) {
      this.root.style.setProperty('--target-x', `${focus.x * 100}%`)
      this.root.style.setProperty('--target-y', `${focus.y * 100}%`)
      this.root.style.setProperty('--target-rx', `${focus.rx * 100}%`)
      this.root.style.setProperty('--target-ry', `${focus.ry * 100}%`)
      const spaceLeft = focus.x - focus.rx
      const spaceRight = 1 - focus.x - focus.rx
      const freeSide = Math.max(spaceLeft, spaceRight)
      const layout = freeSide >= 0.39 ? 'side' : focus.y - focus.ry >= 1 - focus.y - focus.ry ? 'top' : 'bottom'
      this.root.dataset.side = spaceRight > spaceLeft ? 'right' : 'left'
      this.root.dataset.layout = layout
      this.root.style.setProperty('--counter-panel-width', `${Math.min(47, freeSide * 100 - 2)}%`)
    }
  }
}

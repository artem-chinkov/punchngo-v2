import { hintKinds, type HintKind } from '../game/Onboarding'
import { enemyPoses, enemyTypes, handPoses, type AnimationState, type EnemyType } from '../assets/ids'
import { defaultBalance, type Balance, type EnemyBalance } from '../combat/balance'
import type { ParkRun } from '../game/ParkRun'
import { upgradeIds, upgrades, type UpgradeId } from '../game/upgrades'
import { defaultWorld } from '../world/route'
import type { AnimationPreview } from '../rendering/CombatView'

type Field<T> = [key: keyof T, label: string, min: number, max: number]
type Main = Omit<Balance, 'enemies'>
const movement: Field<Main>[] = [
  ['hp', 'Здоровье героя', 1, 999], ['speed', 'Скорость бега', 2, 20],
  ['holdSlowdownPerSecond', 'Замедление при удержании, п. п./с', 0, 50],
  ['holdMinSpeedPercent', 'Минимальная скорость при удержании, %', 0, 100],
  ['dashMultiplier', 'Пик рывка', 1, 3], ['dashLimit', 'Предел скорости', 1, 3],
  ['dashDuration', 'Длительность рывка, с', 0.05, 2], ['laneDuration', 'Смена полосы, с', 0.06, 1],
  ['immunity', 'Неуязвимость после урона, с', 0.1, 3],
]
const combat: Field<Main>[] = [
  ['punchInterval', 'Интервал ударов, с', 0.10, 1.5], ['inputBuffer', 'Буфер тапа, с', 0, 0.25],
  ['damage', 'Урон', 1, 200], ['reach', 'Дальность', 1, 8], ['knockback', 'Отбрасывание', 2, 32],
  ['chainDamage', 'Доля урона цепочки', 0.05, 2], ['chainDepth', 'Глубина цепи', 0, 2], ['chainTargets', 'Цели цепи', 1, 5],
  ['counterWindow', 'Окно контратаки, с', 0.06, 1], ['idealWindow', 'Идеальное окно, с', 0.01, 0.5],
  ['counterDamage', 'Урон контрудара, ×', 1, 5], ['idealDamage', 'Идеальный контрудар, ×', 1, 6],
  ['counterStun', 'Оглушение Бульдога, с', 0.15, 3], ['regularCounterStun', 'Оглушение врага, с', 0.1, 3],
  ['counterScore', 'Очки за контрудар', 0, 500], ['idealScore', 'Очки за идеальный контрудар', 0, 500],
  ['idealTapGap', 'Пауза для идеального тапа, × интервал удара', 1, 4], ['attackGap', 'Пауза между замахами, с', 0.1, 3],
  ['comboGrace', 'Пауза до спада комбо, с', 0.3, 8], ['comboDecay', 'Шаг спада комбо, с', 0.1, 3],
]
const gestures: Field<Main>[] = [
  ['minPunchInterval', 'Минимальный интервал ударов, с', 0.06, 0.5],
  ['holdHurtPause', 'Пауза серии после урона, с', 0, 0.5],
  ['holdRepeatDamage', 'Урон повторов удержания, ×', 0.5, 1],
  ['specialCooldown', 'Интервал после апперкота, с', 0.1, 3],
  ['superSpeed', 'Пик скорости супер-рывка, ×', 1, 5],
  ['superDuration', 'Длительность супер-рывка, с', 0.15, 4],
  ['superPrepare', 'Подготовка супер-рывка, с', 0.01, 1.5],
  ['superFade', 'Затухание супер-рывка, с', 0.01, 2],
  ['superRecovery', 'Восстановление после супер-рывка, с', 0, 3],
  ['superDamage', 'Урон контакта супер-рывка, ×', 0.05, 2],
  ['electricDamage', 'Урон разряда, ×', 0.05, 2], ['electricRadius', 'Радиус разряда', 0.1, 8],
  ['uppercutDamage', 'Урон апперкота, ×', 0.1, 4], ['uppercutForce', 'Импульс вперёд апперкота, ×', 0.1, 4],
  ['uppercutLift', 'Скорость подъёма врага', 1, 12],
  ['uppercutAnimation', 'Длительность анимации апперкота, с', 0.12, 1.5],
  ['uppercutWindup', 'Замах апперкота, с', 0.01, 0.5],
  ['uppercutDrive', 'Выброс кулака апперкота, с', 0.01, 0.5],
  ['uppercutReach', 'Дальность апперкота', 1, 8],
  ['uppercutBrake', 'Торможение апперкота, ед./с', 0, 20],
  ['uppercutMaxRetreat', 'Максимум отступления апперкота', 0, 0.3],
  ['uppercutLungeDistance', 'Дополнительный путь выброса', 0, 2],
  ['uppercutFlight', 'Длительность импульса апперкота, с', 0.1, 2],
  ['uppercutTransfer', 'Передача импульса при рикошете, ×', 0.1, 1.8],
  ['uppercutMaxSpeed', 'Предел скорости цели апперкота', 5, 70],
  ['uppercutChainDepth', 'Глубина цепи апперкота', 0, 3],
  ['landingDamage', 'Урон волны приземления, ×', 0.05, 2], ['landingRadius', 'Радиус волны приземления', 0.1, 6],
  ['sideDamage', 'Урон бокового удара, ×', 0.1, 3], ['sideForce', 'Импульс вперёд бокового удара, ×', 0.1, 3],
  ['sideImpulse', 'Боковой импульс врага', 1, 15],
]
const director: Field<Main>[] = [
  ['spawnRate', 'Частота появления, ×', 0.25, 3], ['density', 'Плотность, ×', 0.5, 1.5],
  ['bossAt', 'Появление Бульдога, с', 10, 600],
  ['rankS', 'Ранг S', 0, 100000], ['rankA', 'Ранг A', 0, 100000], ['rankB', 'Ранг B', 0, 100000],
]
const enemy: Field<EnemyBalance>[] = [
  ['hp', 'HP', 1, 2000], ['contact', 'Контактный урон', 0, 100], ['damage', 'Активный урон', 1, 100],
  ['speed', 'Сближение', 0.05, 12], ['windup', 'Замах, с', 0.2, 3],
  ['recovery', 'Восстановление, с', 0.05, 3], ['resistance', 'Передача импульса', 0.2, 2],
  ['score', 'Очки', 0, 5000], ['xp', 'Опыт', 0, 150],
]
const names: Record<EnemyType, string> = { thug: 'Хулиган', quick: 'Быстрый', brute: 'Громила', bulldog: 'Бульдог' }

export class BalancePanel {
  balance: Balance = structuredClone(defaultBalance)
  readonly world = { ...defaultWorld }
  cameraOpen = false
  seed?: number
  speed = 1
  open = false
  invulnerable = false
  zones = false
  preview?: AnimationPreview
  contextHints = true
  private readonly shell = document.createElement('div')
  private readonly panel: HTMLElement
  private readonly cameraPanel: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly form: HTMLFormElement
  private readonly groups = document.createElement('div')
  private readonly readout: HTMLElement
  private readonly options: (() => void)[] = []
  private readonly seedInput: HTMLInputElement
  private readonly xp: HTMLInputElement
  private readonly level: HTMLInputElement
  private current?: ParkRun
  private nextReadout = 0

  get paused() { return this.open || this.cameraOpen || !!this.preview }

  constructor(root: HTMLElement, private readonly changed: () => void, restart: (atBoss: boolean) => void, resetTutorial: () => void, forceHint: (kind: HintKind) => void) {
    this.shell.innerHTML = `
      <button class="dev-toggle" type="button" aria-expanded="false">DEV</button>
      <section class="dev-panel" aria-label="Панель разработчика" hidden>
        <header><strong>БАЛАНС / PARK V2</strong><button type="button" data-action="close">Закрыть</button></header>
        <div class="dev-actions"><button type="button" data-action="camera">Камера</button><button type="button" data-action="tutorial">Сбросить обучение</button></div>
        <form>
          <div class="dev-actions">
            <button type="submit">Применить и начать</button>
            <button type="submit" data-boss>Применить и к Бульдогу</button>
            <button type="button" data-action="reset">Сброс</button>
          </div>
          <label class="dev-field">Seed <input data-seed type="number" min="0" max="4294967295" placeholder="случайный"></label>
          <label class="dev-field">Скорость времени <input data-speed type="number" value="1" min="0.25" max="12" step="any"></label>
          <label><input data-invincible type="checkbox"> Неуязвимость</label>
          <label><input data-zones type="checkbox"> Зоны, полосы, коллизии, FPS</label>
        </form>
        <details><summary>Текущий забег</summary>
          <div class="dev-actions">
            <button type="button" data-action="boss">К Бульдогу</button>
            <button type="button" data-action="phase1">Фаза I</button>
            <button type="button" data-action="phase2">Фаза II</button>
          </div>
          <label class="dev-field">XP <input data-xp type="number" min="0" value="0"></label>
          <label class="dev-field">Уровень <input data-level type="number" min="1" value="1"></label>
          <button type="button" data-action="progress">Задать прогресс</button>
          <div class="dev-actions"><select data-upgrade aria-label="Улучшение"></select>
            <button type="button" data-action="upgrade">Выдать</button></div>
        </details>
        <details><summary>Обучение</summary>
          <label><input data-context-hints type="checkbox" checked> Контекстные подсказки</label>
          <div class="dev-actions"><select data-tutorial-hint aria-label="Подсказка"></select>
            <button type="button" data-action="hint">Показать подсказку</button></div>
        </details>
        <details><summary>Анимации</summary>
          <div class="dev-actions"><select data-actor aria-label="Персонаж"></select>
            <select data-pose aria-label="Состояние анимации"></select>
            <button type="button" data-action="animation">Показать анимацию</button></div>
        </details>
      </section>
      <section class="dev-camera" aria-label="Предпросмотр камеры" hidden>
        <header><strong>КАМЕРА</strong><button type="button" data-camera-back>Назад в DEV</button></header>
        <label>Высота камеры <output data-camera-height-value></output><input data-camera-height type="range" min="0" max="120"></label>
        <label>Горизонт <output data-horizon-value></output><input data-horizon type="range" min="22" max="50"></label>
        <button type="button" data-camera-reset>Сбросить камеру</button>
      </section>
      <output class="dev-readout" hidden></output>
    `
    root.append(this.shell)
    const find = <T extends HTMLElement>(selector: string) => this.shell.querySelector<T>(selector)!
    this.button = find('.dev-toggle')
    this.panel = find('.dev-panel')
    this.cameraPanel = find('.dev-camera')
    this.form = find('form')
    this.readout = find('.dev-readout')
    this.seedInput = find('[data-seed]')
    this.xp = find('[data-xp]')
    this.level = find('[data-level]')
    const invulnerable = find<HTMLInputElement>('[data-invincible]')
    const zones = find<HTMLInputElement>('[data-zones]')
    const speed = find<HTMLInputElement>('[data-speed]')
    const contextHints = find<HTMLInputElement>('[data-context-hints]')
    contextHints.onchange = () => { this.contextHints = contextHints.checked }
    const hint = find<HTMLSelectElement>('[data-tutorial-hint]')
    const hintLabels: Record<HintKind, string> = { punch: 'Тап / удержание', side: 'Боковой удар',
      superDash: 'Супер-рывок', uppercut: 'Апперкот' }
    for (const kind of hintKinds) hint.add(new Option(hintLabels[kind], kind))
    const upgrade = find<HTMLSelectElement>('[data-upgrade]')
    for (const id of upgradeIds) upgrade.add(new Option(upgrades[id].name, id))
    const actor = find<HTMLSelectElement>('[data-actor]')
    const pose = find<HTMLSelectElement>('[data-pose]')
    actor.add(new Option('Герой', 'hero'))
    for (const id of enemyTypes) actor.add(new Option(names[id], id))
    const selectPoses = () => {
      pose.replaceChildren()
      for (const value of actor.value === 'hero' ? handPoses : enemyPoses) pose.add(new Option(value, value))
    }
    selectPoses()
    actor.onchange = selectPoses
    this.button.onclick = () => this.toggle(!this.open)
    const cameraHeight = find<HTMLInputElement>('[data-camera-height]')
    const horizon = find<HTMLInputElement>('[data-horizon]')
    const heightValue = find<HTMLOutputElement>('[data-camera-height-value]')
    const horizonValue = find<HTMLOutputElement>('[data-horizon-value]')
    const syncCamera = () => {
      cameraHeight.value = String(Math.round(this.world.cameraHeight * 100))
      horizon.value = String(Math.round(this.world.horizon * 100))
      heightValue.value = cameraHeight.value + '%'
      horizonValue.value = horizon.value + '%'
    }
    const changeCamera = () => {
      this.world.cameraHeight = cameraHeight.valueAsNumber / 100
      this.world.horizon = horizon.valueAsNumber / 100
      syncCamera()
      this.changed()
    }
    syncCamera()
    cameraHeight.oninput = horizon.oninput = changeCamera
    find<HTMLButtonElement>('[data-camera-back]').onclick = () => this.toggle(true)
    find<HTMLButtonElement>('[data-camera-reset]').onclick = () => {
      this.world.cameraHeight = defaultWorld.cameraHeight
      this.world.horizon = defaultWorld.horizon
      syncCamera()
      this.changed()
    }
    invulnerable.onchange = () => { this.invulnerable = invulnerable.checked }
    zones.onchange = () => { this.zones = zones.checked }
    speed.onchange = () => { if (speed.validity.valid) this.speed = speed.valueAsNumber }

    this.form.append(this.groups)
    this.renderFields()
    this.form.onsubmit = event => {
      event.preventDefault()
      this.seed = this.seedInput.value === '' ? undefined : this.seedInput.valueAsNumber
      for (const apply of this.options) apply()
      this.toggle(false)
      restart(event.submitter instanceof HTMLElement && event.submitter.hasAttribute('data-boss'))
    }
    this.panel.onclick = event => {
      if (!(event.target instanceof HTMLElement)) return
      const action = event.target.closest('button')?.dataset.action
      if (action === 'close') this.toggle(false)
      if (action === 'camera') {
        this.open = false
        this.cameraOpen = true
        this.panel.hidden = true
        this.button.hidden = true
        this.button.setAttribute('aria-expanded', 'false')
        this.cameraPanel.hidden = false
        this.changed()
        cameraHeight.focus()
      }
      if (action === 'hint') {
        this.toggle(false)
        forceHint(hint.value as HintKind)
      }
      if (action === 'tutorial') {
        this.toggle(false)
        resetTutorial()
      }
      if (action === 'reset') {
        this.balance = structuredClone(defaultBalance)
        this.renderFields()
      }
      if (action === 'boss') { this.current?.debugBoss(); this.toggle(false) }
      if (action === 'phase1' || action === 'phase2') {
        if (!this.current?.combat.boss) this.current?.debugBoss()
        this.current?.debugPhase(action === 'phase1' ? 1 : 2)
        this.toggle(false)
      }
      if (action === 'progress') this.current?.debugProgress(this.xp.valueAsNumber || 0, this.level.valueAsNumber || 1)
      if (action === 'upgrade') this.current?.combat.take(upgrade.value as UpgradeId)
      if (action === 'animation') {
        this.toggle(false)
        this.preview = { type: actor.value as EnemyType | 'hero', pose: pose.value as AnimationState, start: -1 }
        this.button.textContent = 'DEV · ВЫЙТИ ИЗ ПРЕВЬЮ'
      }
    }
  }

  setTutorialHidden(hidden: boolean) { this.shell.hidden = hidden }

  draw(run: ParkRun, fps: number, wall: number) {
    if (this.current !== run) this.current = run
    if (this.preview && this.preview.start < 0) this.preview.start = wall
    this.readout.hidden = !this.zones
    if (!this.zones || wall < this.nextReadout) return
    this.nextReadout = wall + 0.16
    const { runner, combat } = run
    this.readout.textContent = [
      `${Math.round(fps)} FPS · seed ${run.seed} · ${run.phase}`,
      `Z ${runner.z.toFixed(1)} · ${runner.speed.toFixed(1)} м/с · полоса ${runner.lane + 2} · XP ${combat.xp}`,
      `Таран: ${combat.dashPush.members.length} · первое попадание: ${combat.dashPush.directHitSpent ? 'да' : 'нет'}`,
      ...combat.enemies.map(e => `${e.type} #${e.id} ${e.pose} +${(e.z - runner.z).toFixed(1)} ${Math.ceil(e.hp)}HP`),
    ].join('\n')
  }

  private toggle(open: boolean) {
    const wasPreview = !!this.preview
    this.preview = undefined
    this.cameraOpen = false
    this.cameraPanel.hidden = true
    this.button.hidden = false
    this.open = open && !wasPreview
    this.panel.hidden = !this.open
    this.button.textContent = 'DEV'
    this.button.setAttribute('aria-expanded', String(this.open))
    this.changed()
    if (this.open && this.current) {
      this.xp.value = String(this.current.combat.xp)
      this.level.value = String(this.current.level)
    }
  }

  private renderFields() {
    this.groups.replaceChildren()
    this.options.length = 0
    this.section('Герой и движение', this.balance, movement)
    this.section('Удары, цепочки и контратаки', this.balance, combat)
    this.section('Спецприёмы и удержание', this.balance, gestures)
    this.section('Интервалы обучения', this.balance, [['counterTutorialLock', 'Защита учебной контратаки, с', 0, 8]])
    this.section('Спавн, время и ранги', this.balance, director)
    for (const type of enemyTypes) this.section(names[type], this.balance.enemies[type], enemy)
  }

  private section<T extends object>(name: string, values: T, fields: Field<T>[]) {
    const group = document.createElement('details')
    const label = document.createElement('summary')
    label.textContent = name
    group.append(label)
    for (const [key, title, min, max] of fields) {
      const row = document.createElement('label')
      row.className = 'dev-field'
      const text = document.createElement('span')
      text.textContent = title
      const input = document.createElement('input')
      input.type = 'number'
      input.inputMode = 'decimal'
      input.min = String(min)
      input.max = String(max)
      input.step = 'any'
      input.required = true
      input.value = String(values[key])
      input.addEventListener('invalid', () => { group.open = true })
      this.options.push(() => {
        const value = key === 'chainDepth' || key === 'chainTargets' || key === 'uppercutChainDepth' ? Math.round(input.valueAsNumber) : input.valueAsNumber
        values[key] = value as T[typeof key]
      })
      row.append(text, input)
      group.append(row)
    }
    this.groups.append(group)
  }
}

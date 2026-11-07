import type { AudioSettings } from '../audio/settings'
import type { CombatEvent } from '../combat/CombatSystem'
import type { ParkRun, Phase } from '../game/ParkRun'
import type { Records } from '../game/records'
import { levelXP, upgrades, type UpgradeId } from '../game/upgrades'
import { UpgradeReveal } from './UpgradeReveal'

const counts = new Intl.NumberFormat('ru-RU')
const time = (value: number) => {
  const whole = Math.floor(value)
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0')
}

function set(element: Element, value: string) {
  if (element.textContent !== value) element.textContent = value
}

export class HUD {
  private readonly root: HTMLElement
  private readonly screen: HTMLElement
  private readonly display: HTMLElement
  private readonly values: Record<string, HTMLElement> = {}
  private readonly health: HTMLProgressElement
  private readonly xp: HTMLProgressElement
  private readonly route: HTMLProgressElement
  private readonly bossHealth: HTMLProgressElement
  private readonly bossPanel: HTMLElement
  private readonly portrait: HTMLElement
  private readonly lane: HTMLElement
  private readonly pips: HTMLElement
  private readonly signal: HTMLElement
  private readonly feedback: HTMLElement
  private readonly combo: HTMLElement
  private phase?: Phase
  private previousOffer?: UpgradeId[]
  private feedbackUntil = 0
  private previousMultiplier = 1
  private readonly reveal = new UpgradeReveal()
  private audio: AudioSettings
  private wall = 0

  constructor(root: HTMLElement, begin: () => void, choose: (id: UpgradeId) => void,
    audio: AudioSettings, changeAudio: (settings: AudioSettings) => void) {
    this.audio = audio
    this.root = document.createElement('div')
    this.root.className = 'hud'
    this.root.innerHTML = `
      <div class="game-display" hidden>
        <header class="top-bar">
          <div class="health">
            <span class="face" aria-hidden="true"><i></i><b></b></span>
            <div><small>ЗДОРОВЬЕ</small><strong data-value="hp"></strong>
              <progress data-health max="100" aria-label="Здоровье"></progress></div>
          </div>
          <div class="route"><small>PARK / <span data-value="stage"></span></small>
            <strong data-value="time"></strong><progress data-route max="1" aria-label="Прогресс Park"></progress></div>
          <div class="points"><small>ОЧКИ</small><strong data-value="score"></strong></div>
        </header>
        <div class="boss-hud" hidden>
          <small>БУЛЬДОГ <span data-value="bossPhase"></span></small>
          <progress data-boss max="100" aria-label="Здоровье Бульдога"></progress>
        </div>
        <div class="combo-hud"><strong data-combo></strong><span data-feedback></span></div>
        <footer class="bottom-bar">
          <div class="signal" data-signal></div>
          <div class="hud-strip"><span data-value="level"></span>
            <div class="lane-marker" data-lane aria-label="Полоса"><i></i><i></i><i></i></div>
            <div class="pips" data-pips aria-label="Короткая серия"><i></i><i></i><i></i></div>
          </div>
          <progress data-xp max="1" aria-label="Опыт"></progress>
          <button class="hud-mute" data-mute type="button" aria-label="Отключить звук" aria-pressed="false"></button>
        </footer>
      </div>
      <div class="round-overlay"></div>
    `
    root.append(this.root)
    this.screen = this.root.querySelector('.round-overlay')!
    this.display = this.root.querySelector('.game-display')!
    this.health = this.root.querySelector('[data-health]')!
    this.xp = this.root.querySelector('[data-xp]')!
    this.route = this.root.querySelector('[data-route]')!
    this.bossHealth = this.root.querySelector('[data-boss]')!
    this.bossPanel = this.root.querySelector('.boss-hud')!
    this.portrait = this.root.querySelector('.face')!
    this.lane = this.root.querySelector('[data-lane]')!
    this.pips = this.root.querySelector('[data-pips]')!
    this.signal = this.root.querySelector('[data-signal]')!
    this.feedback = this.root.querySelector('[data-feedback]')!
    this.combo = this.root.querySelector('[data-combo]')!
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-value]')) {
      this.values[element.dataset.value!] = element
    }
    const upgradeAt = (target: EventTarget | null) => target instanceof HTMLElement ?
      target.closest('button')?.dataset.upgrade as UpgradeId | undefined : undefined
    this.screen.addEventListener('pointerdown', event => {
      if (event.isPrimary && event.button === 0) this.reveal.down(upgradeAt(event.target), event.pointerId, this.wall)
    })
    this.screen.addEventListener('pointerup', event => {
      if (event.isPrimary) this.reveal.up(upgradeAt(event.target), event.pointerId)
    })
    this.screen.addEventListener('pointercancel', this.cancelInput)
    this.root.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-mute]')) return
      this.audio = { ...this.audio, muted: !this.audio.muted }
      changeAudio(this.audio)
      this.syncAudioControls()
    })
    this.screen.addEventListener('input', event => {
      if (!(event.target instanceof HTMLInputElement)) return
      const channel = event.target.dataset.volume
      if (channel !== 'music' && channel !== 'effects') return
      this.audio = { ...this.audio, [channel]: event.target.valueAsNumber / 100 }
      changeAudio(this.audio)
      this.syncAudioControls()
    })
    this.syncAudioControls()
    this.screen.addEventListener('click', event => {
      if (!(event.target instanceof HTMLElement)) return
      const button = event.target.closest('button')
      if (button?.hasAttribute('data-start')) begin()
      else {
        const card = upgradeAt(event.target)
        const keyboard = event.detail === 0 && (!(event instanceof PointerEvent) || !event.pointerType)
        if (card && this.phase === 'upgrade' && !this.screen.hidden && this.reveal.accept(card, this.wall, keyboard)) choose(card)
      }
    })
  }

  cancelInput = () => this.reveal.cancel()

  reset() {
    this.phase = undefined
    this.previousOffer = undefined
    this.cancelInput()
    this.feedbackUntil = 0
    this.previousMultiplier = 1
    set(this.feedback, '')
  }

  show(event: CombatEvent, now: number) {
    const label = event.kind === 'ideal' ? 'ИДЕАЛЬНО +' + event.points : event.kind === 'counter' ? 'КОНТРУДАР +' + event.points :
      event.kind === 'rage' ? 'БУЛЬДОГ В ЯРОСТИ' : event.kind === 'finish' ? 'НОКАУТ!' : ''
    if (!label) return
    set(this.feedback, label)
    this.feedback.dataset.effect = event.kind
    this.feedbackUntil = now + 0.64
  }

  draw(run: ParkRun, records: Records, wall: number, preview = false) {
    this.wall = wall
    const { combat, phase, now, level } = run
    const boss = combat.boss
    const hp = Math.ceil(combat.hp)
    set(this.values.hp, String(hp))
    this.health.max = run.balance.hp
    this.health.value = hp
    const face = combat.hp === 0 ? 'ko' : now < combat.invulnerableUntil ? 'hit' : hp < run.balance.hp * 0.33 ? 'low' : 'ready'
    if (this.portrait.dataset.face !== face) this.portrait.dataset.face = face
    set(this.values.time, time(now))
    set(this.values.stage, boss ? 'ФИНАЛ' : '01')
    set(this.values.score, counts.format(combat.score))
    this.route.value = Math.min(1, now / run.balance.bossAt)
    set(this.values.level, 'УР. ' + level)
    this.xp.value = Math.max(0, Math.min(1, (combat.xp - levelXP(level)) / (levelXP(level + 1) - levelXP(level))))
    this.bossPanel.hidden = !boss
    if (boss) {
      set(this.values.bossPhase, boss.bossPhase === 2 ? 'II' : 'I')
      this.bossHealth.max = boss.maxHp
      this.bossHealth.value = boss.hp
    }
    const lane = String(run.runner.lane + 1)
    if (this.lane.dataset.selected !== lane) this.lane.dataset.selected = lane
    const pips = String(combat.short)
    if (this.pips.dataset.lit !== pips) this.pips.dataset.lit = pips
    const counter = combat.counterTarget(run.runner, now)
    set(this.signal, counter ? 'ЖЁЛТЫЙ · ТАП ДЛЯ КОНТРАТАКИ' :
      boss ? 'БУЛЬДОГ · СЛЕДИ ЗА ЗАМАХОМ' : now < 19 ? 'ТАП / УДЕРЖАНИЕ — УДАР · СВАЙП — ПОЛОСА' : '')
    this.signal.classList.toggle('counter-ready', !!counter)
    set(this.combo, combat.combo > 1 ? combat.combo + ' COMBO ×' + counts.format(combat.multiplier) : '')
    if (combat.multiplier !== this.previousMultiplier) {
      if (combat.multiplier > this.previousMultiplier) this.combo.animate([
        { transform: 'scale(1.34)', color: '#fff49a' }, { transform: 'scale(1)' },
      ], { duration: 320 })
      this.previousMultiplier = combat.multiplier
    }
    if (run.visualTime >= this.feedbackUntil) set(this.feedback, '')
    this.screen.hidden = preview || (phase !== 'ready' && phase !== 'upgrade' && !run.finished)
    if (phase !== this.phase || run.offer !== this.previousOffer) {
      this.phase = phase
      this.previousOffer = run.offer
      this.display.hidden = phase === 'ready'
      this.cancelInput()
      if (phase === 'ready') this.menu(records)
      else if (phase === 'upgrade') {
        this.reveal.start(wall)
        this.level(run)
      } else if (run.finished) this.result(run, records)
    }
    if (phase === 'upgrade' && !preview) this.revealCards()
  }

  private revealCards() {
    const stage = this.reveal.stage(this.wall)
    const card = this.screen.querySelector<HTMLElement>('.level-card')!
    if (card.dataset.stage === stage) return
    card.dataset.stage = stage
    card.querySelector<HTMLElement>('.level-notice')!.hidden = stage !== 'notice'
    card.querySelector<HTMLElement>('.level-choices')!.hidden = stage === 'notice'
    if (stage === 'ready') {
      for (const button of card.querySelectorAll<HTMLButtonElement>('.upgrade')) button.disabled = false
    }
  }

  private audioControls() {
    return `<details class="audio-options">
      <summary>Настройки звука</summary>
      <label>Музыка <input type="range" data-volume="music" min="0" max="100"><output data-volume-value="music"></output></label>
      <label>Эффекты <input type="range" data-volume="effects" min="0" max="100"><output data-volume-value="effects"></output></label>
      <button type="button" data-mute aria-label="Отключить звук" aria-pressed="false"></button>
    </details>`
  }

  private syncAudioControls() {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-mute]')) {
      button.setAttribute('aria-pressed', String(this.audio.muted))
      set(button, button.classList.contains('hud-mute') ? (this.audio.muted ? '🔇' : '🔊') :
        (this.audio.muted ? '🔇 Звук выключен' : '🔊 Звук включён'))
    }
    for (const channel of ['music', 'effects'] as const) {
      const input = this.screen.querySelector<HTMLInputElement>('[data-volume=' + channel + ']')
      const output = this.screen.querySelector<HTMLOutputElement>('[data-volume-value=' + channel + ']')
      if (!input || !output) continue
      input.value = String(Math.round(this.audio[channel] * 100))
      output.value = input.value + '%'
    }
  }

  private menu(records: Records) {
    this.screen.innerHTML = `
      <section class="round-card intro">
        <p class="round-kicker"><span></span> ARCADE / PARK RUN <b>V2.0</b></p>
        <h1>PUNCH <em>’N’</em><br>GO<span>.</span></h1>
        <p class="menu-copy">Пробеги парк. Разбей группы врагов. Встреть Бульдога.</p>
        <ul class="round-guide">
          <li><span aria-hidden="true">👣</span><p><strong>Бег.</strong> Герой сам бежит по парку.</p></li>
          <li><span aria-hidden="true">🥊</span><p><strong>Удар и рывок.</strong> Тапни для одного удара или удерживай палец для серии.</p></li>
          <li><span aria-hidden="true">↔️</span><p><strong>Свайп.</strong> Смени полосу. Удержание при этом прервётся.</p></li>
          <li><span aria-hidden="true">❗</span><p><strong>Красный сигнал.</strong> Враг замахнулся. Автоудары ждут, отпусти палец.</p></li>
          <li><span aria-hidden="true">🟡</span><p><strong>Контратака.</strong> Тапни на жёлтом, чтобы перебить атаку.</p></li>
          <li><span aria-hidden="true">💥</span><p><strong>Комбо.</strong> Третье попадание подряд даёт широкий хук.</p></li>
        </ul>
        ${records.best ? '<p class="record">РЕКОРД <strong>' + counts.format(records.best.score) + '</strong></p>' : ''}
        ${this.audioControls()}
        <button type="button" data-start>Начать забег <span aria-hidden="true">➜</span></button>
      </section>`
    this.syncAudioControls()
  }

  private level(run: ParkRun) {
    this.screen.innerHTML = `
      <section class="round-card level-card" data-stage="notice" aria-label="Выбор улучшения">
        <p class="round-kicker">УЛУЧШЕНИЕ / УРОВЕНЬ ${run.level}</p>
        <h2 class="level-notice" role="status">Новый уровень</h2>
        <div class="level-choices" hidden>
          <h2>Выбери усиление</h2>
          <div class="upgrades">${run.offer.map(id => {
          const item = upgrades[id]
          const rank = run.combat.build.rank(id)
          return `<button class="upgrade" type="button" disabled data-upgrade="${id}">
            <b class="upgrade-icon" aria-hidden="true">${item.icon}</b>
            <span><strong>${item.name}</strong><small>${item.text}</small></span>
            <span class="upgrade-rank">${rank} → ${rank + 1} / ${item.max}</span>
          </button>`
          }).join('')}</div>
        </div>
      </section>`
  }

  private result(run: ParkRun, records: Records) {
    const result = run.result()
    this.screen.innerHTML = `
      <section class="round-card result-card">
        <p class="round-kicker">PARK / РЕЗУЛЬТАТ</p>
        <div class="result-heading"><h2>${result.won ? 'Парк пройден' : 'Нокаут'}</h2>
          <strong class="rank" aria-label="Ранг ${result.rank}">${result.rank}</strong></div>
        ${result.won ? '' : '<p class="result-cause"></p>'}
        <div class="result-score">${counts.format(result.score)} <small>ОЧКОВ</small></div>
        <dl class="result-stats">
          <div><dt>Повержено</dt><dd>${result.kills}</dd></div>
          <div><dt>Лучшее комбо</dt><dd>${result.bestCombo}</dd></div>
          <div><dt>Контратаки</dt><dd>${result.counters}</dd></div>
          <div><dt>Идеальные</dt><dd>${result.perfect}</dd></div>
          <div><dt>Осталось HP</dt><dd>${result.hp}</dd></div>
          <div><dt>Время</dt><dd>${time(result.time)}</dd></div>
        </dl>
        ${records.best ? '<p class="record">РЕКОРД <strong>' + counts.format(records.best.score) + '</strong></p>' : ''}
        ${this.audioControls()}
        <button type="button" data-start>Новый забег <span aria-hidden="true">➜</span></button>
      </section>`
    const cause = this.screen.querySelector('.result-cause')
    if (cause) set(cause, result.cause)
    this.syncAudioControls()
  }
}

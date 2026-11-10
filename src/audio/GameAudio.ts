import Phaser from 'phaser'
import type { Phase } from '../game/ParkRun'
import type { SfxCue } from './cues'
import manifest from './audio_manifest.json'
import { nextMusicBar, readAudioSettings, saveAudioSettings, type AudioSettings } from './settings'

type TrackKey = 'music.park' | 'music.bulldog.phase1' | 'music.bulldog.phase2'
type Sound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound
type Track = { key: TrackKey; sound: Sound; gain: number; weight: number }
type Voice = { group: string; priority: number; sound: Sound; gain: number }
const tracks = new Map(manifest.music.map(item => [item.key, item]))
const effects = new Map(manifest.sfx.map(item => [item.key, item]))
const prefix = 'punchngo.audio.'
const base = import.meta.env.BASE_URL + 'assets/audio/'
const loop = 'music-loop'
const fadeSeconds = 0.42
const maxVoices = 8

const hitFamily = new Set<SfxCue>(['punch.hit', 'punch.jab_hit', 'punch.heavy_hit', 'dash.impact', 'uppercut.impact'])
function priority(cue: SfxCue) {
  if (cue.startsWith('game.')) return 4
  if (cue === 'boss.windup' || cue.startsWith('counter.')) return 3
  if (cue === 'dash.start' || cue === 'uppercut.ricochet' || cue.startsWith('ui.') || cue === 'player.hurt' || cue === 'boss.attack') return 2
  return hitFamily.has(cue) || cue.startsWith('upgrade.') ? 1 : 0
}

export class GameAudio {
  settings = readAudioSettings()
  private current?: Track
  private dashWind?: Sound
  private outgoing?: Track
  private fadeAge = 0
  private boundary?: { at: number; last: number }
  private target?: TrackKey
  private readonly voices: Voice[] = []
  private readonly variants = new Map<SfxCue, number>()
  private readonly lastCue = new Map<string, number>()
  private phase: Phase = 'ready'
  private started = false
  private foreground = true
  private musicDuck = 1

  constructor(private readonly scene: Phaser.Scene) {
    scene.sound.pauseOnBlur = false
  }

  load() {
    const enqueue = (key: string, file: string, instances: number) => {
      if (!this.scene.cache.audio.exists(key)) {
        this.scene.load.audio(key, [base + file], { instances })
      }
    }
    for (const item of tracks.values()) enqueue(prefix + item.key, item.file, 1)
    for (const item of effects.values()) {
      item.files.forEach((file, index) => enqueue(prefix + item.key + '.' + index, file, 2))
    }
    this.scene.load.start()
  }

  // Called synchronously from the Start click, while Safari still grants user activation.
  unlock() {
    this.started = true
    const manager = this.scene.sound
    if (manager instanceof Phaser.Sound.WebAudioSoundManager && manager.context.state !== 'running') {
      void manager.context.resume().catch(() => {})
    }
  }

  setSettings(settings: AudioSettings) {
    this.settings = saveAudioSettings(settings)
    this.mixMusic()
    if (this.effectGain(1) === 0) this.stopDashWind()
    for (const voice of this.voices) {
      voice.sound.setVolume(this.effectGain(voice.gain))
    }
  }

  setForeground(active: boolean) {
    if (active === this.foreground) return
    this.foreground = active
    if (!active) {
      this.stopDashWind()
      this.clearVoices()
      this.current?.sound.pause()
      this.outgoing?.sound.pause()
      return
    }
    if (this.started) this.unlock()
    this.current?.sound.resume()
    this.outgoing?.sound.resume()
  }

  resetRun() {
    this.stopDashWind()
    this.stopMusic()
    this.clearVoices()
    this.lastCue.clear()
    this.phase = 'ready'
    this.target = undefined
    this.musicDuck = 1
  }

  play(cue: SfxCue) {
    if (!this.started || !this.foreground || !this.canPlay() || this.effectGain(1) === 0) return
    const item = effects.get(cue)
    if (!item) return
    const group = hitFamily.has(cue) ? 'impact' : cue.startsWith('counter.') ? 'counter' : cue
    const now = performance.now()
    const separation = group === 'impact' ? 45 : group === 'enemy.collision' || group === 'uppercut.ricochet' || group === 'enemy.fall' ? 85 : 55
    if (now - (this.lastCue.get(group) ?? -Infinity) < separation) return

    const index = ((this.variants.get(cue) ?? -1) + 1) % item.files.length
    const key = prefix + cue + '.' + index
    if (!this.scene.cache.audio.exists(key)) return
    const rank = priority(cue)
    let groupCount = 0
    let weakest = -1
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]
      if (voice.group === group) groupCount++
      if (weakest < 0 || voice.priority < this.voices[weakest].priority) weakest = i
    }
    if (groupCount >= 2) return
    if (this.voices.length >= maxVoices) {
      if (weakest < 0 || this.voices[weakest].priority >= rank) return
      this.voices.splice(weakest, 1)[0].sound.destroy()
    }
    const sound = this.scene.sound.add(key) as Sound
    const voice = { sound, group, gain: item.volume, priority: rank }
    this.voices.push(voice)
    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      const position = this.voices.indexOf(voice)
      if (position !== -1) this.voices.splice(position, 1)
      sound.destroy()
    })
    if (!sound.play({ volume: this.effectGain(item.volume), rate: cue === 'punch.jab_hit' ? 1.15 : 1 })) {
      this.voices.pop()
      sound.destroy()
      return
    }
    this.variants.set(cue, index)
    this.lastCue.set(group, now)
  }

  updateDashWind(boost: number) {
    const gain = this.effectGain((effects.get('dash.wind')?.volume ?? 0) * Math.min(1, boost))
    if (gain <= 0.01 || !this.started || !this.foreground || !this.canPlay()) {
      this.stopDashWind()
      return
    }
    if (this.dashWind) {
      this.dashWind.setVolume(gain)
      return
    }
    const key = prefix + 'dash.wind.0'
    if (!this.scene.cache.audio.exists(key)) return
    const sound = this.scene.sound.add(key) as Sound
    if (sound.play({ loop: true, volume: gain })) this.dashWind = sound
    else sound.destroy()
  }

  private stopDashWind() {
    this.dashWind?.destroy()
    this.dashWind = undefined
  }

  update(phase: Phase, bossPhase: 1 | 2 | undefined, seconds: number, tutorialPaused = false) {
    if (phase !== this.phase) {
      this.phase = phase
      if (phase === 'victory' || phase === 'defeat') {
        this.stopMusic()
        this.play(phase === 'victory' ? 'game.victory' : 'game.defeat')
      }
    }
    if (!this.started || !this.foreground || !this.canPlay()) return
    const next = phase === 'park' || phase === 'upgrade' ? 'music.park' : phase === 'boss' || phase === 'finisher' ?
      (bossPhase === 2 ? 'music.bulldog.phase2' : 'music.bulldog.phase1') : undefined
    if (this.target !== next) this.boundary = undefined
    this.target = next
    const duck = phase === 'upgrade' || phase === 'finisher' || tutorialPaused ? 0.35 : 1
    this.musicDuck += (duck - this.musicDuck) * Math.min(1, seconds * 9)
    if (phase !== 'finisher' && next && this.current?.key !== next) this.transition(next)
    if (this.outgoing && this.current) {
      this.fadeAge += seconds
      this.current.weight = Math.min(1, this.fadeAge / fadeSeconds)
      this.outgoing.weight = 1 - this.current.weight
      if (this.current.weight >= 1) {
        this.outgoing.sound.destroy()
        this.outgoing = undefined
      }
    }
    this.mixMusic()
  }

  private transition(next: TrackKey) {
    if (!this.scene.cache.audio.exists(prefix + next)) return
    let seek = 0
    if (this.current?.key === 'music.bulldog.phase1' && next === 'music.bulldog.phase2') {
      const cursor = this.current.sound.seek
      if (!this.boundary) {
        this.boundary = { at: nextMusicBar(cursor, tracks.get(this.current.key)!.bpm), last: cursor }
        return
      }
      const wrapped = cursor < this.boundary.last
      this.boundary.last = cursor
      if (cursor < this.boundary.at && !wrapped) return
      // Both boss arrangements have the same tempo and bar count. Continue at the same position.
      seek = cursor
    }
    const item = tracks.get(next)!
    const sound = this.scene.sound.add(prefix + next) as Sound
    const musicalDuration = item.bars * 240 / item.bpm
    const length = Math.min(sound.totalDuration, musicalDuration)
    const marked = length > 0 && sound.addMarker({ name: loop, start: 0, duration: length, config: { loop: true } })
    const weight = this.current ? 0 : 1
    const config = { loop: true, seek: length > 0 ? seek % length : 0,
      volume: weight * this.musicGain(item.volume) }
    const playing = marked ? sound.play(loop, config) : sound.play(config)
    if (!playing) { sound.destroy(); return }
    this.outgoing?.sound.destroy()
    this.outgoing = this.current
    this.current = { key: next, sound, gain: item.volume, weight }
    this.fadeAge = 0
    this.boundary = undefined
  }

  private canPlay() {
    const manager = this.scene.sound
    // A keyboard or accessibility click can resume the context without Phaser's pointer unlock event.
    return manager instanceof Phaser.Sound.WebAudioSoundManager ? manager.context.state === 'running' : !manager.locked
  }

  private effectGain(gain: number) { return this.settings.muted ? 0 : gain * this.settings.effects }
  private musicGain(gain: number) { return this.settings.muted ? 0 : gain * this.settings.music * this.musicDuck }

  private mixMusic() {
    this.mixTrack(this.current)
    this.mixTrack(this.outgoing)
  }

  private mixTrack(track?: Track) {
    if (!track) return
    const volume = track.weight * this.musicGain(track.gain)
    if (Math.abs(volume - track.sound.volume) > 0.0001 || (volume === 0 && track.sound.volume > 0)) {
      track.sound.setVolume(volume)
    }
  }

  private stopMusic() {
    this.current?.sound.destroy()
    this.outgoing?.sound.destroy()
    this.current = this.outgoing = this.boundary = undefined
  }

  private clearVoices() {
    for (const voice of this.voices) voice.sound.destroy()
    this.voices.length = 0
  }
}

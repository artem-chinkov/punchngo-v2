export interface AudioSettings { music: number; effects: number; muted: boolean }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>

const key = 'punchngo.v2.audio'
const defaults: AudioSettings = { music: 1, effects: 1, muted: false }
const gain = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ?
  Math.min(1, Math.max(0, value)) : 1

function normalize(value: Partial<AudioSettings>): AudioSettings {
  return { music: gain(value.music), effects: gain(value.effects), muted: value.muted === true }
}

export function readAudioSettings(storage?: StoragePort): AudioSettings {
  try { return normalize(JSON.parse((storage ?? localStorage).getItem(key) ?? '{}') ?? {}) }
  catch { return { ...defaults } }
}

export function saveAudioSettings(settings: AudioSettings, storage?: StoragePort): AudioSettings {
  const data = normalize(settings)
  try { (storage ?? localStorage).setItem(key, JSON.stringify(data)) } catch { /* session-only settings */ }
  return data
}

export function nextMusicBar(seek: number, bpm: number) {
  const bar = 240 / bpm
  return (Math.floor(seek / bar) + 1) * bar
}

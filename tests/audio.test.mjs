import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } })
after(() => vite.close())
const { nextMusicBar, readAudioSettings, saveAudioSettings } = await vite.ssrLoadModule('/src/audio/settings.ts')

const read = path => readFile(new URL(path, import.meta.url))

test('the shipped audio pack has three music tracks and all 28 WAV files, including the wind loop', async () => {
  const manifest = JSON.parse(await read('../src/audio/audio_manifest.json'))
  assert.deepEqual(manifest.music.map(track => track.key),
    ['music.park', 'music.bulldog.phase1', 'music.bulldog.phase2'])
  const [first, second] = manifest.music.slice(1)
  assert.equal(first.bpm, 168)
  assert.equal(first.bpm, second.bpm)
  assert.equal(first.bars, second.bars)
  const wav = manifest.sfx.flatMap(item => item.files)
  assert.equal(new Set(wav).size, 28)
  for (const path of wav) {
    const file = await read('../public/assets/audio/' + path)
    assert.equal(file.toString('ascii', 0, 4), 'RIFF', path)
    assert.equal(file.toString('ascii', 8, 12), 'WAVE', path)
  }
  for (const track of manifest.music) {
    const file = await read('../public/assets/audio/' + track.file)
    assert.ok(file.length > 0 && track.file.endsWith('.mp3'), track.file)
  }
})

test('audio preferences round trip independently and work if storage is unavailable', () => {
  const cache = new Map()
  const storage = { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) }
  assert.deepEqual(readAudioSettings(storage), { music: 1, effects: 1, muted: false })
  const saved = { music: 0.32, effects: 0.64, muted: true }
  saveAudioSettings(saved, storage)
  assert.deepEqual(readAudioSettings(storage), saved)
  const unavailable = { setItem() { throw Error('offline') } }
  assert.deepEqual(saveAudioSettings(saved, unavailable), saved)
})

test('boss music changes on the next 168 BPM bar, including the end of the loop', () => {
  const bar = 240 / 168
  assert.equal(nextMusicBar(0.01, 168), bar)
  assert.equal(nextMusicBar(bar + 0.01, 168), 2 * bar)
  assert.equal(nextMusicBar(32 * bar - 0.01, 168), 32 * bar)
})

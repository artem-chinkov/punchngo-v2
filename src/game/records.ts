import type { Result } from './ParkRun'

const key = 'punchngo.v2.records'
export interface Records { best?: Result; runs: number; victories: number; totalKills: number }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>

export function readRecords(storage?: StoragePort): Records {
  try {
    const source = storage ?? localStorage
    const data: Records = JSON.parse(source.getItem(key) ?? '{}')
    return {
      best: data.best && Number.isFinite(data.best.score) ? data.best : undefined,
      runs: Number.isFinite(data.runs) ? data.runs : 0,
      victories: Number.isFinite(data.victories) ? data.victories : 0,
      totalKills: Number.isFinite(data.totalKills) ? data.totalKills : 0,
    }
  } catch { return { runs: 0, victories: 0, totalKills: 0 } }
}

export function recordResult(result: Result, storage?: StoragePort): Records {
  const records = readRecords(storage)
  records.runs++
  records.victories += Number(result.won)
  records.totalKills += result.kills
  if (!records.best || result.score > records.best.score) records.best = result
  try { (storage ?? localStorage).setItem(key, JSON.stringify(records)) } catch { /* private session */ }
  return records
}

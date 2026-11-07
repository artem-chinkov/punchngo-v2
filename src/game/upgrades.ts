import type { Random } from './random'

export const upgrades = {
  steel: { name: 'Стальные кулаки', icon: '✦', text: '+20% к урону ударов за уровень.', max: 3, family: 'power' },
  flurry: { name: 'Шквал ударов', icon: '»', text: '+15% к частоте ударов за уровень.', max: 2, family: 'speed' },
  dash: { name: 'Рывок', icon: '➜', text: '+20% к ускорению от удара, до предела скорости.', max: 2, family: 'speed' },
  ram: { name: 'Таран', icon: '◆', text: '+25% к отбрасыванию за уровень.', max: 2, family: 'chain' },
  wave: { name: 'Ударная волна', icon: '◈', text: 'Широкий хук задевает соседние полосы.', max: 1, family: 'chain' },
  domino: { name: 'Домино', icon: '▥', text: '+25% к урону цепочек за уровень.', max: 2, family: 'chain' },
  ricochet: { name: 'Рикошет', icon: '↗', text: 'Летящий враг доворачивает к соседней цели.', max: 1, family: 'chain' },
  uppercut: { name: 'Апперкот', icon: '⇡', text: 'Каждое пятое прямое попадание подбрасывает врага.', max: 1, family: 'power' },
  electric: { name: 'Электрокулаки', icon: 'ϟ', text: 'Хук пускает разряд в ещё одного врага.', max: 1, family: 'power' },
  fire: { name: 'Огненные кулаки', icon: '▲', text: 'Враги горят после попадания. Второй уровень усиливает огонь.', max: 2, family: 'power' },
  precise: { name: 'Точный контрудар', icon: '✷', text: '+30% урона контратаки и +0,2 с оглушения за уровень.', max: 2, family: 'power' },
  breath: { name: 'Второе дыхание', icon: '✚', text: 'Восстанови до 25 HP сразу.', max: 2, family: 'heal' },
} as const
export type UpgradeId = keyof typeof upgrades
export const upgradeIds = Object.keys(upgrades) as UpgradeId[]

export class Build {
  private readonly ranks = new Map<UpgradeId, number>()
  rank(id: UpgradeId) { return this.ranks.get(id) ?? 0 }
  get damage() { return 1 + this.rank('steel') * 0.20 }
  get attackRate() { return 1 + this.rank('flurry') * 0.15 }
  get acceleration() { return 1 + this.rank('dash') * 0.20 }
  get knockback() { return 1 + this.rank('ram') * 0.25 }
  get chainDamage() { return 1 + this.rank('domino') * 0.25 }
  get counterDamage() { return 1 + this.rank('precise') * 0.30 }
  get stunBonus() { return this.rank('precise') * 0.20 }

  take(id: UpgradeId, hp: number, max: number) {
    if (!this.available(id, hp, max)) return false
    this.ranks.set(id, this.rank(id) + 1)
    return true
  }

  offer(random: Random, hp: number, max: number) {
    const available = upgradeIds.filter(id => this.available(id, hp, max))
    const offer: UpgradeId[] = []
    while (offer.length < 3 && available.length) {
      const weight = (id: UpgradeId) => {
        let result = 1
        for (const [owned, level] of this.ranks) if (upgrades[owned].family === upgrades[id].family) result += level * 0.13
        return result
      }
      let draw = random.next() * available.reduce((total, id) => total + weight(id), 0)
      const index = available.findIndex(id => (draw -= weight(id)) < 0)
      offer.push(available.splice(index < 0 ? available.length - 1 : index, 1)[0])
    }
    return offer
  }

  private available(id: UpgradeId, hp: number, max: number) {
    return this.rank(id) < upgrades[id].max && (id !== 'breath' || hp < max)
  }
}

const thresholds = [220, 520, 900, 1390, 1975, 2700, 3500, 4380, 5350, 6400]
export const levelXP = (level: number) => level <= 1 ? 0 : thresholds[level - 2] ??
  thresholds[thresholds.length - 1] + (level - thresholds.length - 1) * 390

import type Phaser from 'phaser'
import type { AssetId, EnemyType } from './ids'

type Graphics = Phaser.GameObjects.Graphics
const ink = 0x20272a
const palette: Record<EnemyType, [number, number, number, number]> = {
  thug: [0xbd4b38, 0xef7a55, 0xd98b62, 0x24373c],
  quick: [0x227e88, 0x58c6bb, 0xe7b483, 0x263341],
  brute: [0x694775, 0xa476a4, 0xba724f, 0x3e3648],
  bulldog: [0x724639, 0xe58848, 0xdba16b, 0x343342],
}

export const cycles = ['stride', 'guard', 'jab', 'flinch'] as const
export type Cycle = typeof cycles[number]

export function drawPlaceholder(g: Graphics, id: AssetId, w: number, h: number, motion?: Cycle, frame = 0) {
  if (id === 'park.sky') {
    g.fillStyle(0xe8bd83).fillRect(0, 0, w, h)
    g.fillStyle(0xf3ce92).fillRect(0, h * 0.32, w, h * 0.68)
    g.fillStyle(0xffe3a6).fillCircle(w * 0.72, h * 0.57, 33)
    return
  }
  if (id === 'park.ridge.far' || id === 'park.ridge.near') {
    const near = id === 'park.ridge.near'
    g.fillStyle(near ? 0x637e59 : 0x9c9d70)
    for (let i = -1; i <= 13; i++) {
      g.fillEllipse(i * 37, h * 0.59, near ? 78 : 96, h * (0.6 + (i & 3) * 0.1))
    }
    g.fillRect(0, h * 0.61, w, h * 0.39)
    return
  }
  if (id === 'park.tree') {
    g.fillStyle(0x332d28).fillRect(61, 86, 24, 127)
    g.fillStyle(0x634634).fillRect(63, 111, 12, 99)
    g.lineStyle(9, 0x463628).lineBetween(71, 161, 37, 111).lineBetween(77, 147, 107, 106)
    g.fillStyle(0x1d4031).fillEllipse(70, 76, 139, 105).fillEllipse(78, 48, 112, 94)
    g.fillStyle(0x326345).fillEllipse(52, 62, 94, 77).fillEllipse(83, 37, 87, 69)
    g.fillStyle(0x508251).fillEllipse(51, 48, 62, 48).fillEllipse(86, 26, 59, 44)
    g.fillStyle(0x769356).fillEllipse(48, 41, 33, 15)
    return
  }
  if (id === 'park.lamp') {
    g.fillStyle(0x252c26).fillRect(24, 36, 8, 164).fillRect(17, 195, 22, 12)
    g.fillStyle(0x586257).fillRect(25, 42, 3, 151)
    g.fillStyle(0x252c26).fillTriangle(9, 21, 27, 4, 47, 21)
    g.fillStyle(0x252c26).fillRect(13, 20, 30, 25)
    g.fillStyle(0xffc866).fillRect(18, 22, 20, 18)
    g.fillStyle(0xffe3a6).fillRect(23, 23, 9, 16)
    return
  }
  if (id === 'park.bench') {
    g.fillStyle(ink).fillRect(16, 28, 7, 41).fillRect(92, 28, 7, 41).fillRect(5, 44, 104, 11)
    g.fillStyle(0x663f33).fillRoundedRect(9, 10, 96, 30, 4).fillRoundedRect(3, 40, 108, 11, 3)
    g.fillStyle(0xc0855d).fillRect(12, 12, 90, 6).fillRect(12, 23, 90, 5).fillRect(8, 41, 98, 5)
    return
  }
  if (id === 'fist.left' || id === 'fist.right') {
    const thumb = id === 'fist.left' ? 96 : 12
    g.fillStyle(ink).fillRoundedRect(26, 76, 99, 128, 28)
    g.fillStyle(0xd98d5d).fillRoundedRect(32, 74, 87, 130, 24)
    g.fillStyle(0x9f543a).fillRect(37, 137, 77, 67)
    g.fillStyle(0x203c3c).fillRect(28, 159, 95, 45)
    g.fillStyle(0x417268).fillRect(29, 158, 94, 12)
    g.fillStyle(ink).fillRoundedRect(11, 26, 128, 104, 28)
    g.fillStyle(0xc3724c).fillRoundedRect(16, 34, 118, 91, 23)
    g.fillStyle(0xf4af77).fillRoundedRect(19, 30, 110, 51, 19)
    g.lineStyle(3, 0xb66a49)
    for (let x = 43; x <= 99; x += 28) g.lineBetween(x, 42, x - 2, 70)
    g.fillStyle(ink).fillRoundedRect(thumb, 69, 44, 44, 15)
    g.fillStyle(0xe39b68).fillRoundedRect(thumb + 3, 72, 37, 33, 13)
    g.fillStyle(0xffd495).fillRoundedRect(28, 34, 56, 6, 3)
    return
  }

  const [shirt, light, skin, pants] = palette[id]
  const boss = id === 'bulldog'
  const x = Math.round(w / 2)
  const torso = w * (boss ? 0.65 : 0.60)
  const head = w * (boss ? 0.42 : id === 'brute' ? 0.42 : 0.44)
  const walking = motion === 'stride'
  const guarding = motion === 'guard'
  const jabbing = motion === 'jab'
  const flinch = motion === 'flinch'
  const cycle = [0, 1, 0, -1][frame % 4]
  const headY = h * 0.23 + (walking ? Math.abs(cycle) * -4 : guarding ? 4 + cycle * 2 : flinch ? -3 + cycle * 2 : 0)
  const bodyY = headY + h * 0.135
  const legTop = h * 0.61
  const outline = 0x171e22
  for (const side of [-1, 1]) {
    const leg = x + torso * 0.20 * side
    const step = walking ? cycle * side * 8 : flinch ? side * 4 : 0
    g.lineStyle(Math.round(torso * 0.34), outline).lineBetween(leg, legTop, leg + step, h * 0.912 - Math.max(0, step / 2))
    g.lineStyle(Math.round(torso * 0.24), pants).lineBetween(leg, legTop, leg + step, h * 0.896 - Math.max(0, step / 2))
    g.fillStyle(outline).fillRect(leg + step - torso * 0.16, h * 0.91 - Math.max(0, step / 2), torso * 0.33, h * 0.065)
    g.fillStyle(0x535657).fillRect(leg + step - torso * 0.14, h * 0.93 - Math.max(0, step / 2), torso * 0.27, 3)
  }
  g.fillStyle(outline).fillRoundedRect(x - torso / 2 - 4, bodyY, torso + 8, h * 0.315, 10)
  g.fillStyle(shirt).fillRoundedRect(x - torso / 2, bodyY + 3, torso, h * 0.285, 7)
  g.fillStyle(light).fillRect(x - torso * 0.28, bodyY + 8, torso * 0.56, 6)
  g.fillStyle(outline, 0.58).fillRect(x - torso * 0.4, bodyY + h * 0.245, torso * 0.8, 6)
  if (boss) {
    g.fillStyle(0xffcf70).fillRect(x - 14, bodyY + 18, 28, 10)
    g.fillStyle(0x744132).fillRect(x - 5, bodyY + 18, 10, 10)
  }
  for (const side of [-1, 1]) {
    const shoulder = x + side * torso * 0.51
    const strike = jabbing && side === (frame < 2 ? -1 : 1)
    const fistX = shoulder + side * (strike ? -torso * 0.28 : flinch ? 9 : guarding ? -4 : 4)
    const fistY = bodyY + h * (strike ? 0.045 : guarding ? 0.072 : flinch ? 0.12 : 0.21) +
      (walking ? side * cycle * 9 : guarding || flinch ? cycle * side * 4 : 0)
    const size = Math.round(w * (strike ? 0.30 : boss ? 0.24 : 0.19))
    g.lineStyle(Math.round(w * 0.19), outline).lineBetween(shoulder, bodyY + 12, fistX, fistY)
    g.lineStyle(Math.round(w * 0.135), shirt).lineBetween(shoulder, bodyY + 12, fistX, fistY)
    g.fillStyle(outline).fillRoundedRect(fistX - size / 2 - 2, fistY - size / 2 - 2, size + 4, size + 4, 5)
    g.fillStyle(boss ? 0x9b4032 : skin).fillRoundedRect(fistX - size / 2, fistY - size / 2, size, size, 4)
    g.fillStyle(light).fillRect(fistX - size / 3, fistY - size / 3, size * 0.58, 3)
  }
  g.fillStyle(outline).fillRoundedRect(x - head / 2 - 3, headY - h * 0.112, head + 6, h * 0.22, 7)
  g.fillStyle(skin).fillRoundedRect(x - head / 2, headY - h * 0.10, head, h * 0.19, 5)
  g.fillStyle(boss ? 0x463331 : 0x352e2d).fillRect(x - head / 2, headY - h * 0.104, head, h * 0.055)
  if (boss) {
    g.fillStyle(0x493333).fillRect(x - head * 0.58, headY - 20, 13, 17).fillRect(x + head * 0.40, headY - 20, 13, 17)
    g.fillStyle(0xf7d2a1).fillRoundedRect(x - head * 0.40, headY + 2, head * 0.80, 17, 5)
    g.fillStyle(0x59362d).fillRect(x - 7, headY + 1, 14, 5).fillRect(x - 12, headY + 12, 24, 3)
    g.fillStyle(0xffedc2).fillRect(x - 10, headY + 10, 4, 5).fillRect(x + 6, headY + 10, 4, 5)
  } else {
    if (id === 'quick') g.fillStyle(light).fillRect(x - head / 2 - 2, headY - h * 0.051, head + 4, 5)
    g.fillStyle(outline).fillRect(x - 6, headY + h * 0.055, 12, flinch ? 5 : 3)
    if (id === 'brute') g.fillStyle(0xf1c981).fillRect(x - 12, bodyY + 20, 24, 6)
  }
  g.fillStyle(outline).fillRect(x - head * 0.33, headY - 3, 9, 4).fillRect(x + head * 0.33 - 9, headY - 3, 9, 4)
}

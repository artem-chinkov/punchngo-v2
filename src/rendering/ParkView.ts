import { route } from '../world/route'
import type Phaser from 'phaser'
import type { AssetRegistry } from '../assets/AssetRegistry'
import type { AssetId } from '../assets/ids'
import type { PerspectiveProjector } from './PerspectiveProjector'

type ParkProp = 'park.tree' | 'park.bench' | 'park.lamp'
const decorations: Record<ParkProp, number> = { 'park.tree': 1, 'park.bench': 0.72, 'park.lamp': 0.83 }

export class ParkView {
  private readonly sky: Phaser.GameObjects.Image
  private readonly farRidge: Phaser.GameObjects.Image
  private readonly nearRidge: Phaser.GameObjects.Image
  private readonly ground: Phaser.GameObjects.Graphics
  private readonly props: Record<ParkProp, Phaser.GameObjects.Image[]>
  private previous?: PerspectiveProjector
  private previousDistance = 0
  private previousIntensity = 0

  constructor(scene: Phaser.Scene, private readonly assets: AssetRegistry) {
    this.sky = assets.image('park.sky').setDepth(-10003)
    this.farRidge = assets.image('park.ridge.far').setDepth(-10002)
    this.nearRidge = assets.image('park.ridge.near').setDepth(-10001)
    this.ground = scene.add.graphics().setDepth(-9999)
    const pool = (id: AssetId, size: number) => Array.from({ length: size }, () => assets.image(id).setVisible(false))
    this.props = { 'park.tree': pool('park.tree', 34), 'park.bench': pool('park.bench', 9), 'park.lamp': pool('park.lamp', 12) }
  }

  draw(projector: PerspectiveProjector, viewDistance: number, intensity: number) {
    const { width, height, horizon, cameraZ, heading, curvature, cameraX } = projector
    const previous = this.previous
    if (previous && previous.width === width && previous.height === height && previous.horizon === horizon &&
      previous.cameraZ === cameraZ && previous.cameraX === cameraX && previous.curvature === curvature &&
      previous.cameraHeight === projector.cameraHeight &&
      this.previousDistance === viewDistance && this.previousIntensity === intensity) return
    this.previous = projector
    this.previousDistance = viewDistance
    this.previousIntensity = intensity

    this.assets.place(this.sky, 'park.sky', width / 2 - heading * 10 - cameraX * 4, 0, 1, (horizon + 21) / 265)
    this.assets.place(this.farRidge, 'park.ridge.far', width / 2 - heading * 21 - cameraX * 6, horizon - 43, 1)
    this.assets.place(this.nearRidge, 'park.ridge.near', width / 2 - heading * 28 - cameraX * 8, horizon - 29, 1)

    const ground = this.ground.clear()
    ground.fillStyle(0x496343).fillRect(0, horizon + 17, width, height - horizon)
    const start = Math.floor(cameraZ)
    const finish = Math.ceil(cameraZ + viewDistance)
    let far = projector.project(0, finish)
    for (let z = finish - 1; z >= start; z--) {
      const near = projector.project(0, Math.max(cameraZ, z))
      const nearEdge = route.halfWidth * 73 * near.scale / 1.32
      const farEdge = route.halfWidth * 73 * far.scale / 1.32
      const stripe = Math.floor(z / 3) % 2 === 0
      ground.fillStyle(stripe ? 0x4f6a47 : 0x55724a).fillRect(0, far.y, width, near.y - far.y + 0.7)
      this.band(near.x, near.y, nearEdge * 1.10, far.x, far.y, farEdge * 1.10, 0x70573e)
      this.band(near.x, near.y, nearEdge * 1.035, far.x, far.y, farEdge * 1.035, 0xe8ba79)
      this.band(near.x, near.y, nearEdge, far.x, far.y, farEdge, stripe ? 0xbb8d61 : 0xc69a6b)
      if (z % 4 === 1) {
        ground.lineStyle(Math.max(0.7, near.scale * 1.8), 0xf6d6a0, 0.43)
        const nearLane = nearEdge * route.laneWidth / (2 * route.halfWidth)
        const farLane = farEdge * route.laneWidth / (2 * route.halfWidth)
        ground.lineBetween(near.x - nearLane, near.y, far.x - farLane, far.y)
        ground.lineBetween(near.x + nearLane, near.y, far.x + farLane, far.y)
      }
      if (z % 3 === 0) {
        const dx = Math.sin(z * 17) * nearEdge * 0.72
        ground.fillStyle(0x775b45, 0.48).fillRect(near.x + dx, near.y - 2, Math.max(1, 5 * near.scale), Math.max(1, near.scale * 1.6))
      }
      far = near
    }

    let trees = 0
    let benches = 0
    let lamps = 0
    for (let index = Math.max(0, Math.ceil(cameraZ / 2.5)); index * 2.5 < cameraZ + viewDistance; index++) {
      const side = index % 2 ? -1 : 1
      const type = index % 8 === 5 ? 'park.bench' : index % 5 === 2 ? 'park.lamp' : 'park.tree'
      const x = side * (type === 'park.bench' ? 3.23 : type === 'park.lamp' ? 3.12 : 3.9 + (index % 5) * 0.36)
      const point = projector.project(x, index * 2.5)
      if (point.x < -140 || point.x > width + 140) continue
      const image = this.props[type][type === 'park.tree' ? trees++ : type === 'park.bench' ? benches++ : lamps++]
      if (!image) continue
      this.assets.place(image, type, point.x, point.y, point.scale * decorations[type])
      image.setVisible(true).setDepth(-point.distance * 10).setAlpha(Math.min(1, (viewDistance - point.distance) / 5))
    }
    for (let i = trees; i < this.props['park.tree'].length; i++) this.props['park.tree'][i].setVisible(false)
    for (let i = benches; i < this.props['park.bench'].length; i++) this.props['park.bench'][i].setVisible(false)
    for (let i = lamps; i < this.props['park.lamp'].length; i++) this.props['park.lamp'][i].setVisible(false)
    if (intensity > 0) ground.fillStyle(0x512e33, intensity * 0.10).fillRect(0, 0, width, height)
  }

  private band(nx: number, ny: number, nw: number, fx: number, fy: number, fw: number, color: number) {
    this.ground.fillStyle(color).beginPath()
      .moveTo(nx - nw, ny + 0.5).lineTo(fx - fw, fy).lineTo(fx + fw, fy)
      .lineTo(nx + nw, ny + 0.5).closePath().fillPath()
  }
}

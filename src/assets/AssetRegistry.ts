import type Phaser from 'phaser'
import { cycles, drawPlaceholder, type Cycle } from './placeholders'
import { rasterPack } from './rasterPack'
import { enemyTypes, type AnimationState, type AssetId } from './ids'

interface AssetLayout {
  width: number
  height: number
  origin: readonly [number, number]
  scale: number
}

export type RasterAsset =
  | { png: string }
  | { png: string; atlas: string; poses: Partial<Record<AnimationState, readonly string[]>> }

export type AssetPack = Partial<Record<AssetId, RasterAsset>>

const layout: Record<AssetId, AssetLayout> = {
  thug: { width: 104, height: 165, origin: [0.5, 0.985], scale: 1 },
  quick: { width: 92, height: 148, origin: [0.5, 0.985], scale: 1 },
  bulldog: { width: 150, height: 186, origin: [0.5, 0.985], scale: 1 },
  brute: { width: 132, height: 179, origin: [0.5, 0.985], scale: 1 },
  'fist.left': { width: 150, height: 204, origin: [0.49, 0.44], scale: 1 },
  'fist.right': { width: 150, height: 204, origin: [0.51, 0.44], scale: 1 },
  'park.tree': { width: 145, height: 216, origin: [0.5, 0.985], scale: 1 },
  'park.lamp': { width: 56, height: 208, origin: [0.5, 0.985], scale: 1 },
  'park.bench': { width: 114, height: 72, origin: [0.5, 0.985], scale: 1 },
  'park.sky': { width: 420, height: 265, origin: [0.5, 0], scale: 1 },
  'park.ridge.far': { width: 420, height: 72, origin: [0.5, 0], scale: 1 },
  'park.ridge.near': { width: 440, height: 56, origin: [0.5, 0], scale: 1 },
}

function assetUrl(path: string) {
  return path.startsWith('/assets/') ? import.meta.env.BASE_URL + path.slice(1) : path
}

export class AssetRegistry {
  private readonly pack: AssetPack

  constructor(private readonly scene: Phaser.Scene, mode: 'placeholder' | 'raster') {
    this.pack = mode === 'raster' ? rasterPack : {}
  }

  preload() {
    for (const [id, asset] of Object.entries(this.pack)) {
      if ('atlas' in asset) this.scene.load.atlas('raster:' + id, assetUrl(asset.png), assetUrl(asset.atlas))
      else this.scene.load.image('raster:' + id, assetUrl(asset.png))
    }
  }

  create() {
    const graphics = this.scene.make.graphics({}, false)
    for (const [id, spec] of Object.entries(layout) as [AssetId, AssetLayout][]) {
      const key = 'placeholder:' + id
      if (this.scene.textures.exists(key)) continue
      graphics.clear()
      drawPlaceholder(graphics, id, spec.width, spec.height)
      graphics.generateTexture(key, spec.width, spec.height)
    }
    for (const id of enemyTypes) {
      const { width, height } = layout[id]
      for (const motion of cycles) for (let frame = 0; frame < 4; frame++) {
        const key = 'placeholder:' + id + ':' + motion + ':' + frame
        if (this.scene.textures.exists(key)) continue
        graphics.clear()
        drawPlaceholder(graphics, id, width, height, motion, frame)
        graphics.generateTexture(key, width, height)
      }
    }
    graphics.destroy()
  }

  image(id: AssetId) {
    const image = this.scene.add.image(0, 0, 'placeholder:' + id)
    this.pose(image, id, 'idle', 0)
    return image
  }

  pose(image: Phaser.GameObjects.Image, id: AssetId, pose: AnimationState, elapsed: number) {
    const asset = this.pack[id]
    const rasterKey = 'raster:' + id
    let key = 'placeholder:' + id
    let frame: string | undefined
    if (asset && this.scene.textures.exists(rasterKey)) {
      if ('atlas' in asset) {
        const frames = asset.poses[pose]?.length ? asset.poses[pose] : asset.poses.idle
        if (frames?.length) {
          const index = Math.floor(Math.max(0, elapsed) * 12)
          const selected = frames[pose === 'idle' || pose === 'approach' || pose === 'positioning'
            ? index % frames.length : Math.min(index, frames.length - 1)]
          if (this.scene.textures.get(rasterKey).has(selected)) {
            key = rasterKey
            frame = selected
          }
        }
      } else {
        key = rasterKey
      }
    }
    if (key.startsWith('placeholder:') && enemyTypes.some(type => type === id)) {
      let cycle: Cycle | undefined
      if (pose === 'approach' || pose === 'positioning' || pose === 'retreat') cycle = 'stride'
      else if (pose === 'telegraph' || pose === 'laneTell' || pose === 'rage') cycle = 'guard'
      else if (pose === 'attack') cycle = 'jab'
      else if (pose === 'hit' || pose === 'knockback' || pose === 'sideFlight' || pose === 'stunned' ||
        pose === 'airborne' || pose === 'fall' || pose === 'defeated' || pose === 'finish') cycle = 'flinch'
      if (cycle) key += ':' + cycle + ':' + (Math.floor(Math.max(0, elapsed) * (cycle === 'jab' ? 24 : 14)) % 4)
    }
    if (image.texture.key !== key || (frame !== undefined && image.frame.name !== frame)) {
      image.setTexture(key, frame)
    }
  }

  place(image: Phaser.GameObjects.Image, id: AssetId, x: number, y: number, scaleX: number, scaleY = scaleX) {
    const spec = layout[id]
    image.setOrigin(...spec.origin).setPosition(x, y)
      .setDisplaySize(spec.width * spec.scale * scaleX, spec.height * spec.scale * scaleY)
  }
}

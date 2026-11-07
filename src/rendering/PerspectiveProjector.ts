import { roadCenter, roadHeading, type WorldSettings } from '../world/route'

export class PerspectiveProjector {
  readonly horizon: number
  readonly heading: number
  readonly curvature: number
  private readonly center: number

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cameraZ: number,
    private readonly settings: WorldSettings,
    readonly cameraX = 0,
    dash = 0,
  ) {
    this.horizon = height * settings.horizon + dash * 6
    this.curvature = settings.curvature
    this.heading = roadHeading(cameraZ) * this.curvature
    this.center = roadCenter(cameraZ)
  }

  project(x: number, z: number) {
    const distance = z - this.cameraZ
    const perspective = 3.15 / (3.15 + Math.max(0, distance))
    const curve = (roadCenter(z) - this.center) * this.curvature - this.heading * distance * 0.48
    const scale = perspective * 1.32
    return {
      x: this.width / 2 + (x + curve - this.cameraX) * 73 * perspective,
      y: this.horizon + (this.height + 12 - this.horizon) * perspective,
      scale,
      distance,
      visible: distance >= 0 && distance <= this.settings.viewDistance,
    }
  }
}

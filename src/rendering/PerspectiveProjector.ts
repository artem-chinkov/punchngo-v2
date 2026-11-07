import { roadCenter, roadHeading, type WorldSettings } from '../world/route'

export class PerspectiveProjector {
  readonly horizon: number
  readonly heading: number
  readonly curvature: number
  readonly cameraHeight: number
  private readonly center: number
  private readonly groundDepth: number

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
    this.cameraHeight = settings.cameraHeight
    // The 0% setting still has a positive projection distance. Keep the existing 70–120% scale.
    this.groundDepth = 3.15 * (this.cameraHeight < 0.70 ? 0.35 + Math.max(0, this.cameraHeight) * 0.5 : this.cameraHeight)
    this.heading = roadHeading(cameraZ) * this.curvature
    this.center = roadCenter(cameraZ)
  }

  project(x: number, z: number) {
    const distance = z - this.cameraZ
    const depth = Math.max(0, distance)
    const perspective = 3.15 / (3.15 + depth)
    const groundPerspective = this.groundDepth / (this.groundDepth + depth)
    const curve = (roadCenter(z) - this.center) * this.curvature - this.heading * distance * 0.48
    const scale = perspective * 1.32
    return {
      x: this.width / 2 + (x + curve - this.cameraX) * 73 * perspective,
      y: this.horizon + (this.height + 12 - this.horizon) * groundPerspective,
      scale,
      distance,
      visible: distance >= 0 && distance <= this.settings.viewDistance,
    }
  }
}

export type Lane = -1 | 0 | 1
export const lanes: readonly Lane[] = [-1, 0, 1]
export const route = { halfWidth: 2.65, laneWidth: 1.63 }
export const laneX = (lane: Lane) => lane * route.laneWidth

export interface WorldSettings {
  horizon: number
  viewDistance: number
  curvature: number
}

export const defaultWorld: WorldSettings = { horizon: 0.35, viewDistance: 45, curvature: 1 }

export function roadCenter(z: number): number {
  return 6 * Math.sin(z / 18) + 2.2 * Math.sin(z / 7)
}

export function roadHeading(z: number): number {
  return 6 / 18 * Math.cos(z / 18) + 2.2 / 7 * Math.cos(z / 7)
}

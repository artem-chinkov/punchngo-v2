/** Earliest intersection of a segment with a centered box in relative coordinates. */
export function sweepBox(x: number, z: number, y: number, dx: number, dz: number, dy: number,
  width: number, behind: number, ahead: number, height: number) {
  let enter = 0
  let exit = 1
  if (dx) {
    const a = (-width - x) / dx, b = (width - x) / dx
    enter = Math.max(enter, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  } else if (Math.abs(x) > width) return Infinity
  if (dz) {
    const a = (-behind - z) / dz, b = (ahead - z) / dz
    enter = Math.max(enter, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  } else if (z < -behind || z > ahead) return Infinity
  if (dy) {
    const a = (-height - y) / dy, b = (height - y) / dy
    enter = Math.max(enter, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  } else if (Math.abs(y) > height) return Infinity
  return enter <= exit ? enter : Infinity
}

/** A lane box with a front that grows linearly during the segment. */
export function sweepGrowingBox(x: number, z: number, y: number, dx: number, dz: number, dy: number,
  width: number, reach0: number, reach1: number, height: number) {
  let enter = 0, exit = 1
  const below = (value: number, change: number) => {
    if (Math.abs(change) < 1e-12) return value <= 1e-10
    const time = -value / change
    if (change < 0) enter = Math.max(enter, time)
    else exit = Math.min(exit, time)
    return enter <= exit + 1e-12
  }
  if (!below(x - width, dx) || !below(-x - width, -dx) ||
    !below(-z, -dz) || !below(z - reach0, dz - (reach1 - reach0)) ||
    !below(y - height, dy) || !below(-y - height, -dy)) return Infinity
  return enter <= exit && enter <= 1 && exit >= 0 ? Math.max(0, enter) : Infinity
}

/** Planar disc contact intersected with the vertical overlap interval. */
export function sweepBodies(x: number, z: number, y: number, dx: number, dz: number, dy: number,
  radius: number, height: number) {
  let enter = 0
  let exit = 1
  const a = dx * dx + dz * dz
  const c = x * x + z * z - radius * radius
  if (a > 1e-12) {
    const b = x * dx + z * dz
    const discriminant = b * b - a * c
    if (discriminant < 0) return Infinity
    const root = Math.sqrt(discriminant)
    enter = Math.max(0, (-b - root) / a)
    exit = Math.min(1, (-b + root) / a)
  } else if (c > 0) return Infinity
  if (Math.abs(dy) > 1e-12) {
    const from = (-height - y) / dy
    const to = (height - y) / dy
    enter = Math.max(enter, Math.min(from, to))
    exit = Math.min(exit, Math.max(from, to))
  } else if (Math.abs(y) > height) return Infinity
  return enter <= exit ? enter : Infinity
}

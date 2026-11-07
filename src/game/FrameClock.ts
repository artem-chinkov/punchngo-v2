const step = 1 / 60

export class FrameClock {
  private remainder = 0
  private skip = false

  reset() {
    this.remainder = 0
    this.skip = true
  }

  frame(milliseconds: number, speed: number, tick?: (step: number) => boolean) {
    const elapsed = this.skip ? 0 : Math.min(milliseconds / 1000, step * 5)
    this.skip = false
    if (!tick) return elapsed

    this.remainder += elapsed * speed
    let budget = 24
    while (this.remainder >= step && budget-- > 0) {
      this.remainder -= step
      if (!tick(step)) break
    }
    this.remainder = Math.min(this.remainder, step * 5)
    return elapsed
  }
}

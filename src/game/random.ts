export class Random {
  constructor(private state: number) {}

  next() {
    this.state = (this.state + 0x6d2b79f5) | 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  index(length: number) { return Math.floor(this.next() * length) }
}

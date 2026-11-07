const holdDelay = 180

export class TouchController {
  private pointer?: number
  private x = 0
  private y = 0
  private since = 0
  private wandered = false
  private swiped = false
  private held = false

  constructor(private readonly canvas: HTMLCanvasElement,
    private readonly enabled: () => boolean,
    private readonly attack: () => void,
    private readonly lane: (direction: -1 | 1) => void,
  ) {
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.cancelPointer)
    canvas.addEventListener('lostpointercapture', this.cancelPointer)
    canvas.addEventListener('contextmenu', this.preventMenu)
    window.addEventListener('blur', this.cancel)
    document.addEventListener('visibilitychange', this.cancel)
  }

  isHolding(now = performance.now()) {
    if (this.pointer === undefined || this.wandered || this.swiped || !this.enabled()) return false
    if (now - this.since >= holdDelay) this.held = true
    return this.held
  }

  cancel = () => {
    const pointer = this.pointer
    this.pointer = undefined
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer)
  }

  destroy() {
    this.cancel()
    this.canvas.removeEventListener('pointerdown', this.down)
    this.canvas.removeEventListener('pointermove', this.move)
    this.canvas.removeEventListener('pointerup', this.up)
    this.canvas.removeEventListener('pointercancel', this.cancelPointer)
    this.canvas.removeEventListener('lostpointercapture', this.cancelPointer)
    this.canvas.removeEventListener('contextmenu', this.preventMenu)
    window.removeEventListener('blur', this.cancel)
    document.removeEventListener('visibilitychange', this.cancel)
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointer !== undefined || !this.enabled()) return
    event.preventDefault()
    this.pointer = event.pointerId
    this.x = event.clientX
    this.y = event.clientY
    this.since = event.timeStamp
    this.wandered = this.swiped = this.held = false
    this.canvas.setPointerCapture(event.pointerId)
  }

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer || this.swiped) return
    const dx = event.clientX - this.x
    const dy = event.clientY - this.y
    if (Math.hypot(dx, dy) > 13) this.wandered = true
    if (Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      this.swiped = true
      if (this.enabled()) this.lane(dx < 0 ? -1 : 1)
    }
  }

  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return
    this.move(event)
    const tap = !this.held && !this.wandered && !this.swiped && event.timeStamp - this.since <= 320
    this.cancel()
    if (tap && this.enabled()) this.attack()
  }

  private cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.cancel()
  }

  private preventMenu = (event: MouseEvent) => event.preventDefault()
}

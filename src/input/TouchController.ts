export type Swipe = 'up' | 'down' | 'left' | 'right'
export type InputMode = 'play' | 'counter' | 'off'

const holdDelay = 150
const tapSlop = 13

export class TouchController {
  private readonly contacts = new Set<number>()
  private gesture?: { id: number; x: number; y: number; since: number; mode: InputMode;
    moved: boolean; consumed: boolean; held: boolean; dashed: boolean }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly mode: () => InputMode,
    private readonly tap: (mode: 'play' | 'counter') => void, private readonly swipe: (direction: Swipe) => void,
    private readonly now = () => performance.now(),
    private readonly scope: HTMLElement = canvas,
  ) {
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.cancelPointer)
    canvas.addEventListener('lostpointercapture', this.cancelPointer)
    canvas.addEventListener('contextmenu', this.preventMenu)
    window.addEventListener('pointerdown', this.trackDown, true)
    window.addEventListener('pointerup', this.trackEnd, true)
    window.addEventListener('pointercancel', this.trackEnd, true)
    window.addEventListener('blur', this.interrupt)
    document.addEventListener('visibilitychange', this.interrupt)
  }

  get hasContacts() { return this.contacts.size > 0 }

  hold() {
    const g = this.gesture
    if (!g || g.consumed || g.mode !== 'play' || this.mode() !== 'play') return undefined
    if (!g.held && !g.moved && this.now() - g.since >= holdDelay) g.held = true
    return g.held ? { dash: !g.dashed } : undefined
  }

  acceptHold() {
    if (this.gesture?.held) this.gesture.dashed = true
  }

  cancel = () => {
    const g = this.gesture
    this.gesture = undefined
    if (g && this.canvas.hasPointerCapture(g.id)) this.canvas.releasePointerCapture(g.id)
  }

  destroy() {
    this.cancel()
    this.canvas.removeEventListener('pointerdown', this.down)
    this.canvas.removeEventListener('pointermove', this.move)
    this.canvas.removeEventListener('pointerup', this.up)
    this.canvas.removeEventListener('pointercancel', this.cancelPointer)
    this.canvas.removeEventListener('lostpointercapture', this.cancelPointer)
    this.canvas.removeEventListener('contextmenu', this.preventMenu)
    window.removeEventListener('pointerdown', this.trackDown, true)
    window.removeEventListener('pointerup', this.trackEnd, true)
    window.removeEventListener('pointercancel', this.trackEnd, true)
    window.removeEventListener('blur', this.interrupt)
    document.removeEventListener('visibilitychange', this.interrupt)
    this.contacts.clear()
  }

  private interrupt = () => {
    this.cancel()
    this.contacts.clear()
  }

  private trackDown = (event: PointerEvent) => {
    if (event.button === 0 && event.target instanceof Node && this.scope.contains(event.target)) {
      this.contacts.add(event.pointerId)
    }
  }

  private trackEnd = (event: PointerEvent) => { this.contacts.delete(event.pointerId) }

  private down = (event: PointerEvent) => {
    if (event.button === 0) this.contacts.add(event.pointerId)
    const mode = this.mode()
    if (event.button !== 0 || event.isPrimary === false || this.gesture || mode === 'off' ||
      (mode === 'counter' && this.contacts.size > 1)) return
    event.preventDefault()
    this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, since: this.now(), mode,
      moved: false, consumed: false, held: false, dashed: false }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private move = (event: PointerEvent) => {
    const g = this.gesture
    if (!g || event.pointerId !== g.id || g.consumed) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y
    const x = Math.abs(dx)
    const y = Math.abs(dy)
    if (Math.hypot(dx, dy) > tapSlop) g.moved = true
    const threshold = Math.max(25, Math.min(35, 28 * this.canvas.clientWidth / 375))
    const direction = x >= threshold && x >= y * 1.25 ? (dx < 0 ? 'left' : 'right') :
      y >= threshold && y >= x * 1.25 ? (dy < 0 ? 'up' : 'down') : undefined
    if (!direction) return
    g.consumed = true
    if (g.mode === 'play' && this.mode() === 'play') this.swipe(direction)
  }

  private up = (event: PointerEvent) => {
    this.trackEnd(event)
    const g = this.gesture
    if (!g || event.pointerId !== g.id) return
    this.move(event)
    const tap = (g.mode !== 'counter' || !this.hasContacts) && !g.held && !g.moved && !g.consumed && this.now() - g.since < holdDelay
    this.cancel()
    if (tap && this.mode() === g.mode && g.mode !== 'off') this.tap(g.mode)
  }

  private cancelPointer = (event: PointerEvent) => {
    if (event.type === 'pointercancel') this.trackEnd(event)
    if (event.pointerId === this.gesture?.id) this.cancel()
  }

  private preventMenu = (event: MouseEvent) => event.preventDefault()
}

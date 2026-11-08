import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false, watch: null } })
after(() => vite.close())
const load = path => vite.ssrLoadModule('/src/' + path + '.ts')
const { ParkRun } = await load('game/ParkRun')
const { Runner } = await load('game/Runner')
const { Random } = await load('game/random')
const { upgradeIds, upgrades, levelXP } = await load('game/upgrades')
const { defaultBalance } = await load('combat/balance')
const { setPose } = await load('combat/EnemyAI')
const { defaultWorld, laneX } = await load('world/route')
const { TouchController } = await load('input/TouchController')
const { recordResult, readRecords } = await load('game/records')
const { PerspectiveProjector } = await load('rendering/PerspectiveProjector')

const dt = 1 / 60
const balance = () => structuredClone(defaultBalance)
const newRun = (seed = 1, settings = balance()) => new ParkRun(settings, defaultWorld, seed)
const events = (combat, kind) => combat.events.filter(event => event.kind === kind)
const play = (run, seconds, invulnerable = false) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.update(dt, invulnerable)
}
const place = (run, type = 'thug', lane = 0, z = 2, hp = 120) => {
  const enemy = run.combat.spawn(type, lane, run.runner.z + z, run.now)
  enemy.hp = enemy.maxHp = hp
  return enemy
}

test('continuous progress and boss time are independent of dashing and missed attacks', () => {
  const settings = balance()
  settings.bossAt = 10
  const slow = newRun(7, settings)
  const fast = newRun(7, settings)
  slow.start()
  fast.start()
  assert.equal(fast.tap(), true)
  assert.equal(fast.combat.combo, 0)
  assert.equal(fast.combat.xp, 0)
  assert.equal(events(fast.combat, 'miss').length, 1)
  for (let i = 0; i < 602; i++) {
    slow.update(dt, true)
    fast.update(dt, true)
    if (i % 15 === 0) fast.tap()
    assert.ok(slow.runner.z > slow.runner.previousZ)
    assert.ok(fast.runner.z > fast.runner.previousZ)
  }
  assert.equal(slow.phase, 'boss')
  assert.equal(fast.phase, 'boss')
  assert.equal(slow.now, fast.now)
  assert.ok(fast.runner.z > slow.runner.z + 15)
})

test('lane changes are bounded, ease across 180 ms and affect camera-relative aim', () => {
  const run = newRun()
  run.start()
  run.swipe(-1)
  run.swipe(-1)
  assert.equal(run.runner.lane, -1)
  play(run, 0.08)
  assert.ok(run.runner.x < 0 && run.runner.x > laneX(-1))
  play(run, 0.15)
  assert.equal(run.runner.x, laneX(-1))
  const left = place(run, 'thug', -1)
  const right = place(run, 'thug', 1)
  run.tap()
  assert.equal(left.hp, 120 - defaultBalance.damage)
  assert.equal(right.hp, 120)
  const view = new PerspectiveProjector(360, 640, run.runner.z, defaultWorld, run.runner.x)
  assert.ok(view.project(left.x, left.z).x < view.project(right.x, right.z).x)
  assert.equal(run.swipe(1), true)
  assert.equal(run.swipe(1), false)
  play(run, 0.20, true)
  assert.equal(run.swipe(1), true)
  play(run, 0.20, true)
  assert.equal(run.runner.x, laneX(1))
})

test('four gestures are exclusive, holding stops on swipe or release, and tutorial requires a fresh tap', () => {
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  globalThis.window = new EventTarget()
  globalThis.document = new EventTarget()
  class Canvas extends EventTarget {
    clientWidth = 375
    capture
    setPointerCapture(id) { this.capture = id }
    hasPointerCapture(id) { return this.capture === id }
    releasePointerCapture() { this.capture = undefined }
  }
  const canvas = new Canvas()
  const actions = []
  let now = 0
  let mode = 'play'
  const input = new TouchController(canvas, () => mode,
    source => actions.push('tap:' + source), swipe => actions.push(swipe), () => now)
  const pointer = (type, x = 80, y = 80, id = 1, primary = true) => {
    now += 20
    canvas.dispatchEvent(Object.assign(new Event('pointer' + type, { cancelable: true }),
      { pointerId: id, isPrimary: primary, button: 0, clientX: x, clientY: y }))
  }
  try {
    pointer('down')
    pointer('up', 80, 80, 2, false)
    pointer('up')
    for (const [x, y] of [[40, 80], [120, 80], [80, 40], [80, 120]]) {
      pointer('down')
      pointer('move', x, y)
      pointer('up', 120, 120)
    }
    pointer('down')
    pointer('up', 115, 115)
    pointer('down')
    now += 149
    assert.equal(input.hold(), undefined)
    now++
    assert.deepEqual(input.hold(), { dash: true })
    input.acceptHold()
    assert.deepEqual(input.hold(), { dash: false })
    pointer('up')
    assert.equal(input.hold(), undefined)

    pointer('down')
    now += 160
    assert.ok(input.hold())
    pointer('move', 120, 80)
    assert.equal(input.hold(), undefined)
    pointer('up')
    pointer('down')
    globalThis.window.dispatchEvent(new Event('blur'))
    pointer('up')
    pointer('down')
    globalThis.document.dispatchEvent(new Event('visibilitychange'))
    pointer('up')
    pointer('down')
    pointer('cancel')
    pointer('up')

    mode = 'off'
    pointer('down')
    pointer('up')
    mode = 'play'
    pointer('down')
    now += 160
    assert.ok(input.hold())
    input.cancel()
    mode = 'counter'
    pointer('down', 80, 80, 2, false)
    pointer('up')
    pointer('down')
    pointer('up', 80, 120)
    pointer('down')
    now += 180
    assert.equal(input.hold(), undefined)
    pointer('up')
    pointer('down')
    pointer('up')
    assert.deepEqual(actions, ['tap:play', 'left', 'right', 'up', 'down', 'right', 'tap:counter'])
  } finally {
    input.destroy()
    globalThis.window = oldWindow
    globalThis.document = oldDocument
  }
})

test('punches respect cooldown, buffer expiration and maximum dash speed', () => {
  const run = newRun()
  run.start()
  const { combat, runner } = run
  assert.equal(combat.tap(runner, 0), true)
  assert.equal(combat.tap(runner, 0.04), false)
  assert.equal(combat.tap(runner, 0.21), false)
  combat.update(runner, 0.25, dt)
  assert.equal(combat.strike.hand, 'right')
  assert.equal(events(combat, 'miss').length, 2)
  combat.tap(runner, 0.46)
  run.clearInput()
  combat.update(runner, 0.51, dt)
  assert.equal(events(combat, 'miss').length, 2)
  combat.take('dash')
  combat.take('dash')
  for (let i = 0; i < 45; i++) {
    runner.launchDash(combat.build.acceleration)
    assert.ok(runner.dash <= run.balance.dashLimit - 1)
    runner.advance(dt)
    assert.ok(runner.speed <= run.balance.speed * run.balance.dashLimit)
  }
})

test('ordinary hits alternate without an automatic hook; a miss preserves combo', () => {
  const run = newRun()
  const { combat, runner } = run
  const a = place(run, 'thug', 0, 2, 300)
  const neighbor = place(run, 'thug', 1, 2.3, 300)
  for (let i = 0; i < 4; i++) {
    assert.equal(combat.tap(runner, i * 0.25), true)
    assert.equal(combat.strike.kind, 'punch')
    assert.equal(combat.strike.hand, i % 2 === 0 ? 'left' : 'right')
  }
  assert.equal(a.hp, 300 - run.balance.damage * 4)
  assert.equal(neighbor.hp, 300)
  const combo = combat.combo
  combat.enemies.length = 0
  combat.tap(runner, 1)
  assert.equal(combat.combo, combo)
  run.start()
  play(run, 0.20)
  assert.equal(combat.combo, combo)
})

test('vertical swipes share one cooldown without consuming or borrowing the ordinary punch timer', () => {
  const run = newRun()
  run.start()
  const { combat, runner, balance } = run
  const target = place(run, 'thug', 0, 2, 400)
  const left = place(run, 'thug', -1, 2.25, 400)
  const right = place(run, 'thug', 1, 2.5, 400)
  assert.equal(run.special('hook'), true)
  assert.equal(combat.strike.kind, 'hook')
  assert.equal(target.hp, 400 - balance.damage * 1.5)
  assert.equal(left.hp, 400 - balance.damage * balance.hookSplashDamage)
  assert.equal(right.hp, 400)
  assert.equal(run.special('uppercut'), false)
  assert.equal(combat.strike.kind, 'hook')
  assert.equal(runner.dash, 0)
  assert.equal(run.tap(), true)
  assert.equal(combat.strike.kind, 'punch')
  run.now = 0.699
  assert.equal(run.special('uppercut'), false)
  run.now = 0.7
  assert.equal(run.special('uppercut'), true)
  assert.equal(combat.strike.kind, 'uppercut')
  assert.equal(target.hp, 400 - balance.damage * (1.5 + 1 + 1.25))
  assert.equal(target.pose, 'airborne')
  assert.ok(target.y > 0 && target.vy > 0)
  assert.equal(runner.lane, 0)
  assert.equal(run.special('hook'), false)
  run.now = 1.4
  combat.enemies.length = 0
  assert.equal(run.special('hook'), true)
  assert.equal(combat.strike.hit, false)
  assert.equal(run.special('uppercut'), false)
})

test('side swipe hits each of two lanes once; another swipe during travel or off the road has no effect', () => {
  const run = newRun()
  run.start()
  const { combat, runner, balance } = run
  const center = place(run, 'thug', 0, 1.6)
  const otherCenter = place(run, 'thug', 0, 2.4)
  const right = place(run, 'thug', 1, 1.8)
  const left = place(run, 'thug', -1, 1.7)
  assert.equal(run.swipe(1), true)
  assert.equal(runner.lane, 1)
  assert.equal(runner.x, 0)
  assert.equal(combat.strike.kind, 'sideRight')
  for (const hit of [center, right]) assert.equal(hit.hp, 120 - balance.damage * 0.7)
  for (const missed of [left, otherCenter]) assert.equal(missed.hp, 120)
  assert.equal(runner.dash, 0)
  assert.equal(run.swipe(-1), false)
  runner.advance(0.18)
  assert.equal(run.swipe(1), false)
  assert.deepEqual(events(combat, 'side').map(e => e.enemy), [center.id, right.id])
  assert.equal(events(combat, 'hit').length, 0)
  assert.equal(run.swipe(-1), true)
  assert.equal(combat.strike.kind, 'sideLeft')
})

test('group contact spends HP once, knocks enemies aside and respects invulnerability', () => {
  const run = newRun()
  run.start()
  place(run, 'thug', 0, 0.63)
  place(run, 'quick', 0, 0.68)
  play(run, 0.07)
  assert.equal(run.combat.hp, 95)
  assert.equal(events(run.combat, 'hurt').length, 1)
  assert.ok(run.combat.enemies.every(enemy => enemy.flightUntil > run.now))
  place(run, 'brute', 0, 0.58)
  play(run, 0.05)
  assert.equal(run.combat.hp, 95)
  assert.equal(events(run.combat, 'hurt').length, 1)
  play(run, 0.9)
  place(run, 'brute', 0, 0.57)
  play(run, 0.05)
  assert.equal(run.combat.hp, 87)
  assert.ok(run.runner.z > 6)
})

test('ordinary and ideal counters interrupt the attack and apply distinct scores', () => {
  for (const [tapAt, score] of [[0.84, 50], [0.965, 100]]) {
    const run = newRun()
    const target = place(run)
    setPose(target, 'telegraph', 0, 1)
    run.combat.tap(run.runner, tapAt)
    assert.equal(target.pose, 'stunned')
    assert.equal(run.combat.score, score)
    assert.equal(run.combat.counters, 1)
    assert.equal(run.combat.perfect, Number(score === 100))
  }
  const run = newRun()
  const enemy = place(run)
  setPose(enemy, 'telegraph', 0, 1)
  run.combat.update(run.runner, 1.01, dt)
  assert.equal(run.combat.hp, 85)
  assert.equal(enemy.pose, 'attack')
})

test('director seed is reproducible, quick telegraphs a lane change, and brute resists knockback', () => {
  const signature = seed => {
    const run = newRun(seed)
    const ids = new Map()
    run.start()
    for (let i = 0; i < 35 * 60; i++) {
      run.update(dt, true)
      for (const e of run.combat.enemies) if (!ids.has(e.id)) ids.set(e.id, [e.type, e.lane, e.z])
    }
    return [...ids.values()]
  }
  assert.deepEqual(signature(81), signature(81))
  assert.notDeepEqual(signature(81), signature(82))

  const run = newRun()
  const quick = place(run, 'quick', 1, 11)
  quick.nextLane = 0
  run.combat.update(run.runner, dt, dt, true)
  assert.equal(quick.pose, 'laneTell')
  assert.equal(quick.x, laneX(1))
  assert.equal(quick.destination, 0)
  for (let i = 2; i < 60; i++) run.combat.update(run.runner, i * dt, dt, true)
  assert.equal(quick.x, 0)

  const velocity = type => {
    const match = newRun()
    const enemy = place(match, type)
    match.combat.tap(match.runner, 0)
    return enemy.vz
  }
  assert.ok(velocity('brute') < velocity('thug'))
})

test('chain contacts occur over time, award once, and respect depth and target caps', () => {
  const run = newRun()
  run.balance.chainTargets = 3
  run.balance.knockback = 21
  const { combat, runner } = run
  const targets = [1.5, 3.4, 5.3, 7.2, 9.1].map(z => place(run, 'thug', 0, z))
  combat.tap(runner, 0)
  const chain = targets[0].chain
  assert.equal(targets[1].hp, 120)
  let first = 0
  let second = 0
  for (let i = 1; i < 105; i++) {
    combat.update(runner, i * dt, dt, true)
    if (!first && targets[1].hp < 120) first = i
    if (!second && targets[2].hp < 120) second = i
  }
  assert.ok(first > 1 && second > first)
  assert.equal(chain.visited.size, 3)
  assert.equal(events(combat, 'chain').length, 2)
  assert.equal(combat.score, 50)
  assert.equal(targets[3].hp, 120)

  const limited = newRun()
  limited.balance.chainDepth = 0
  place(limited, 'thug', 0, 1.5)
  const untouched = place(limited, 'thug', 0, 3.4)
  limited.combat.tap(limited.runner, 0)
  for (let i = 1; i < 75; i++) limited.combat.update(limited.runner, i * dt, dt, true)
  assert.equal(untouched.hp, 120)
})

test('XP is one-time, level choices pause all movement and time, and runs start fresh', () => {
  const run = newRun()
  run.start()
  run.combat.xp = levelXP(2) - run.balance.enemies.thug.xp
  const enemy = place(run, 'thug', 0, 1.4, 1)
  run.tap()
  assert.equal(run.combat.xp, levelXP(2))
  assert.equal(run.combat.kills, 1)
  assert.equal(run.combat.score, 100)
  run.update(dt)
  assert.equal(run.phase, 'upgrade')
  const snapshot = [run.runner.z, run.now, enemy.z]
  play(run, 2)
  assert.deepEqual([run.runner.z, run.now, enemy.z], snapshot)
  assert.equal(new Set(run.offer).size, 3)
  const id = run.offer[0]
  assert.equal(run.choose(id), true)
  assert.equal(run.combat.build.rank(id), 1)
  assert.equal(run.phase, 'park')
  assert.equal(run.choose(id), false)
  const fresh = newRun()
  assert.equal(fresh.combat.xp, 0)
  assert.equal(fresh.level, 1)
  assert.equal(fresh.combat.build.rank(id), 0)
})

test('all upgrade ranks cap correctly; healing, power, speed, dash, chain and precise stats stack', () => {
  const run = newRun()
  const { combat } = run
  assert.equal(combat.take('breath'), false)
  for (const id of upgradeIds) {
    for (let i = 0; i < upgrades[id].max; i++) {
      if (id === 'breath') combat.hp = 88
      assert.equal(combat.take(id), true)
      if (id === 'breath') assert.equal(combat.hp, 100)
    }
    assert.equal(combat.take(id), false)
  }
  assert.equal(combat.build.damage, 1.6)
  assert.equal(combat.punchInterval, run.balance.punchInterval / 1.30)
  assert.equal(combat.build.acceleration, 1.4)
  assert.equal(combat.build.knockback, 1.5)
  assert.equal(combat.build.chainDamage, 1.5)
  assert.equal(combat.build.counterDamage, 1.6)
  assert.equal(combat.build.stunBonus, 0.4)
  assert.deepEqual(combat.build.offer(new Random(3), 100, 100), [])

  const match = newRun()
  for (const id of ['steel', 'ram', 'precise']) match.combat.take(id)
  const boss = place(match, 'bulldog', 1, 2, 800)
  setPose(boss, 'telegraph', 0, 1)
  match.combat.tap(match.runner, 0.88)
  assert.ok(Math.abs(boss.hp - (800 - match.balance.damage * 1.2 * match.balance.counterDamage * 1.3)) < 0.001)
  assert.equal(boss.until, 0.88 + match.balance.counterStun + 0.2)
  assert.ok(boss.vz > match.balance.knockback)
})

test('wave and electricity apply only to the manual hook and share unique targets with fire', () => {
  const run = newRun()
  const { combat, runner } = run
  for (const id of ['wave', 'electric', 'fire', 'uppercut']) combat.take(id)
  runner.changeLane(-1)
  runner.advance(0.18)
  const primary = place(run, 'thug', -1, 1.8, 400)
  const middle = place(run, 'thug', 0, 2.3, 400)
  const outer = place(run, 'thug', 1, 2.6, 400)
  const extra = place(run, 'thug', -1, 4.5, 400)
  for (let i = 0; i < 5; i++) combat.tap(runner, i * 0.25)
  assert.equal(events(combat, 'wave').length, 0)
  assert.equal(events(combat, 'electric').length, 0)
  assert.equal(primary.pose, 'knockback')
  assert.equal(middle.hp, 400)
  assert.equal(combat.special(runner, 1.01, 'hook'), true)
  assert.ok(middle.hp < 400 && outer.hp < 400 && extra.hp < 400)
  assert.equal(events(combat, 'electric').length, 1)
  assert.equal(events(combat, 'fire').filter(e => e.enemy === primary.id).length, 1)
  assert.equal(primary.burnTicks, 4)
  const hp = primary.hp
  combat.update(runner, 1.02, dt, true)
  assert.ok(primary.hp < hp)
})

test('an upgraded uppercut makes one damaging wave on physical landing even if its source was defeated', () => {
  for (const upgraded of [false, true]) {
    const run = newRun()
    const { combat, runner, balance } = run
    balance.chainDepth = 0
    if (upgraded) combat.take('uppercut')
    const primary = place(run, 'thug', 0, 1.7, 15)
    assert.equal(combat.special(runner, 0, 'uppercut'), true)
    assert.equal(primary.hp, 0)
    assert.equal(primary.pose, 'airborne')
    combat.update(runner, dt, dt, true)
    assert.ok(primary.y > 0.04)
    assert.equal(events(combat, 'landing').length, 0)
    const other = place(run, 'thug', 1, 5.1, 120)
    for (let i = 2; i <= 68; i++) combat.update(runner, i * dt, dt, true)
    assert.equal(primary.y, 0)
    assert.equal(primary.landingWave, undefined)
    assert.equal(events(combat, 'landing').length, upgraded ? 1 : 0)
    assert.equal(other.hp, 120 - (upgraded ? balance.damage * balance.landingDamage : 0))
  }
})

test('ricochet turns toward a neighbor and domino strengthens the actual collision', () => {
  const run = newRun()
  const { combat, runner } = run
  run.balance.knockback = 21
  combat.take('ricochet')
  combat.take('domino')
  const first = place(run, 'thug', 0, 1.5)
  const flank = place(run, 'thug', 1, 4)
  combat.tap(runner, 0)
  for (let i = 1; i < 35; i++) combat.update(runner, i * dt, dt, true)
  assert.ok(first.x > 0.4)
  assert.equal(flank.hp, 120 - run.balance.damage * run.balance.chainDamage * 1.25)
})

test('boss withstands ordinary hits, takes collisions, changes phase, and avoids contact damage', () => {
  const run = newRun()
  run.debugBoss()
  const { combat, runner } = run
  const boss = combat.boss
  boss.z = runner.z + 2.5
  boss.hp = boss.maxHp / 2 + 2
  setPose(boss, 'telegraph', run.now, 0.78)
  run.tap()
  assert.equal(boss.pose, 'telegraph')
  assert.equal(boss.bossPhase, 2)
  assert.equal(events(combat, 'rage').length, 1)
  const hp = combat.hp
  boss.z = runner.z + 0.35
  run.update(dt)
  assert.equal(combat.hp, hp)
  assert.ok(boss.z > runner.z)
  play(run, 1.5, true)
  assert.ok(combat.enemies.some(enemy => enemy.type === 'thug'))
  assert.notEqual(run.phase, 'upgrade')
})

test('a thrown minion damages Bulldog without interrupting his wind-up', () => {
  const run = newRun()
  run.debugBoss()
  const { combat, runner } = run
  const boss = combat.boss
  boss.z = runner.z + 4.5
  setPose(boss, 'telegraph', run.now, 0.82)
  place(run, 'thug', 0, 1.7, 22)
  run.tap()
  for (let i = 1; i <= 22; i++) combat.update(runner, run.now + i * dt, dt, true)
  assert.ok(boss.hp < boss.maxHp)
  assert.equal(boss.pose, 'telegraph')
})

test('results track defeat, rank thresholds and persistent best record', () => {
  const run = newRun()
  run.start()
  run.combat.hp = 3
  place(run, 'brute', 0, 0.54)
  run.update(dt)
  assert.equal(run.phase, 'defeat')
  const result = run.result()
  assert.equal(result.hp, 0)
  assert.match(result.cause, /Столкновение/)
  assert.equal(result.rank, 'C')
  const memory = new Map()
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }
  assert.equal(readRecords(storage).runs, 0)
  recordResult(result, storage)
  for (const [score, rank] of [[run.balance.rankB, 'B'], [run.balance.rankA, 'A'], [run.balance.rankS, 'S']]) {
    run.combat.score = score
    assert.equal(run.result().rank, rank)
  }
  recordResult({ ...run.result(), won: true }, storage)
  recordResult(result, storage)
  assert.equal(readRecords(storage).runs, 3)
  assert.equal(readRecords(storage).best.score, run.balance.rankS)
  assert.equal(readRecords(storage).victories, 1)
})

test('asset registry loads PNG/atlas, uses the anchor, and falls back to procedural motion', async () => {
  const { AssetRegistry } = await load('assets/AssetRegistry')
  const { rasterPack } = await load('assets/rasterPack')
  const requests = []
  const scene = {
    load: { atlas: (...args) => requests.push(args), image: (...args) => requests.push(args) },
    textures: { exists: () => true, get: () => ({ has: name => name !== 'missing' }) },
  }
  const image = {
    texture: { key: 'placeholder:thug' }, frame: { name: '' },
    setTexture(key, frame) { this.texture.key = key; this.frame.name = frame; return this },
    setOrigin(...origin) { this.origin = origin; return this },
    setPosition() { return this },
    setDisplaySize(...size) { this.size = size; return this },
  }
  rasterPack.thug = { png: '/assets/thug.png', atlas: '/assets/thug.json', poses: { idle: ['idle'], approach: ['missing'] } }
  rasterPack['park.lamp'] = { png: '/assets/lamp.png' }
  try {
    const assets = new AssetRegistry(scene, 'raster')
    assets.preload()
    assert.equal(requests.length, 2)
    assets.pose(image, 'thug', 'idle', 0)
    assert.equal(image.texture.key, 'raster:thug')
    assets.place(image, 'thug', 30, 50, 0.5)
    assert.deepEqual(image.origin, [0.5, 0.985])
    assert.deepEqual(image.size, [52, 82.5])
    assets.pose(image, 'thug', 'approach', 0.08)
    assert.equal(image.texture.key, 'placeholder:thug:stride:1')
  } finally {
    delete rasterPack.thug
    delete rasterPack['park.lamp']
  }
})

test('full seeded Park run with default settings reaches both boss phases and victory without invulnerability', () => {
  const run = newRun(7)
  run.start()
  let tapAt = 0
  let swipeAt = 0
  let choices = 0
  let bossAt = 0
  let phase2 = false
  let supports = false
  let finishedStrike = false
  for (let frame = 0; frame < 205 * 60 && !run.finished; frame++) {
    run.update(dt)
    const { combat, runner, now } = run
    assert.ok(combat.enemies.filter(enemy => enemy.type !== 'bulldog' && enemy.hp > 0 &&
      (enemy.pose === 'telegraph' || enemy.pose === 'attack')).length <= 1)
    if (run.phase === 'upgrade') {
      assert.ok(now < run.balance.bossAt)
      const chosen = run.offer.includes('breath') && combat.hp < 72 ? 'breath' :
        run.offer.find(id => ['steel', 'precise', 'domino', 'wave', 'fire'].includes(id)) ?? run.offer[0]
      assert.equal(run.choose(chosen), true)
      choices++
    }
    const boss = combat.boss
    if (boss) {
      bossAt ||= now
      assert.ok(boss.z >= runner.z)
      if (boss.bossPhase === 2) {
        phase2 = true
        supports ||= combat.enemies.some(enemy => enemy.type !== 'bulldog')
      }
    }
    if (run.phase === 'finisher') {
      finishedStrike = true
      continue
    }
    if (!run.active) continue
    if (now >= swipeAt) {
      const goal = boss?.hp > 0 && boss.pose !== 'telegraph' ? boss :
        combat.enemies.filter(enemy => enemy.hp > 0 && enemy.z - runner.z >= 2.5 && enemy.z - runner.z < 13)
          .sort((a, b) => (a.z + (a.type === 'brute' ? 5 : 0)) - (b.z + (b.type === 'brute' ? 5 : 0)))[0]
      const own = combat.enemies.some(enemy => enemy.hp > 0 && enemy.z - runner.z > -0.25 && enemy.z - runner.z < 4.6 &&
        Math.abs(enemy.x - runner.x) < 0.74)
      if (goal && !own && Math.abs(goal.x - laneX(runner.lane)) > 0.95) {
        run.swipe(goal.x < runner.x ? -1 : 1)
        swipeAt = now + 0.53
      }
    }
    if (now < tapAt) continue
    const target = combat.counterTarget(runner, now)
    const threatening = combat.enemies.some(enemy => enemy.pose === 'telegraph' && enemy.hp > 0 &&
      (enemy.type === 'bulldog' || Math.abs(enemy.x - runner.x) < 0.8) && enemy.z - runner.z < 5)
    const ready = combat.enemies.some(enemy => enemy.hp > 0 && enemy.z - runner.z >= -0.25 &&
      enemy.z - runner.z <= 3.12 && Math.abs(enemy.x - runner.x) < (enemy.type === 'bulldog' ? 1.40 : 0.74))
    if (target || (!threatening && ready)) {
      run.tap()
      tapAt = now + (target ? 0.29 : 0.34)
    }
  }
  assert.equal(run.phase, 'victory')
  assert.ok(bossAt >= run.balance.bossAt && bossAt < run.balance.bossAt + dt)
  assert.ok(run.now >= 160 && run.now <= 195)
  assert.ok(choices >= 4 && choices <= 6)
  assert.ok(phase2 && supports && finishedStrike)
  assert.ok(run.result().kills >= 45)
  assert.ok(run.result().counters >= 8)
  assert.ok(run.result().hp > 0)
  assert.ok(run.result().score >= run.balance.rankB)
})

test('resuming after a suspended frame discards wall time and advances on the next frame', async () => {
  const { FrameClock } = await load('game/FrameClock')
  const clock = new FrameClock()
  const run = newRun()
  run.start()
  const tick = seconds => { run.update(seconds); return true }
  clock.frame(20, 1, tick)
  const time = run.now
  const position = run.runner.z
  clock.reset()
  assert.equal(clock.frame(180000, 1, tick), 0)
  assert.equal(run.now, time)
  assert.equal(run.runner.z, position)
  clock.frame(20, 1, tick)
  assert.ok(run.now > time && run.now < time + 0.04)
  assert.ok(run.runner.z > position)
})

test('hold repeats on red and yellow without counters, and only its first accepted hit dashes', () => {
  const run = newRun()
  const { combat, runner } = run
  combat.take('flurry')
  combat.take('dash')
  const interval = combat.punchInterval
  assert.equal(combat.holdAttack(runner, 0, true), true)
  assert.equal(runner.dash, run.balance.dashMultiplier - 1)
  runner.advance(interval)
  const dash = runner.dash
  assert.equal(combat.holdAttack(runner, interval - 0.001), false)
  assert.equal(combat.holdAttack(runner, interval), true)
  assert.equal(runner.dash, dash)
  assert.equal(events(combat, 'miss').length, 2)

  const boss = place(run, 'bulldog', 0, 2, 1000)
  setPose(boss, 'telegraph', 0.5, 0.55)
  assert.equal(combat.holdAttack(runner, 0.6), true)
  assert.equal(boss.pose, 'telegraph')
  assert.equal(combat.counterTarget(runner, 0.98), boss)
  assert.equal(combat.holdAttack(runner, 0.98), true)
  assert.equal(combat.strike.kind, 'punch')
  assert.equal(combat.counters, 0)
  assert.equal(combat.tap(runner, 1.01), true)
  assert.equal(combat.perfect, 1)
  assert.equal(boss.pose, 'stunned')
})

test('a nonlethal hit pauses autoattacks only briefly, even during an active enemy attack', () => {
  const run = newRun()
  run.start()
  const enemy = place(run, 'thug', 0, 1.4)
  setPose(enemy, 'telegraph', run.now, dt)
  assert.equal(run.update(dt, false, { dash: false }), false)
  assert.ok(run.combat.hp < run.balance.hp)
  assert.equal(enemy.pose, 'attack')
  const damagedAt = run.now
  assert.equal(run.combat.holdAttack(run.runner, damagedAt + run.balance.holdHurtPause - 0.001), false)
  assert.equal(run.combat.holdAttack(run.runner, damagedAt + run.balance.holdHurtPause), true)
  assert.equal(run.combat.strike.kind, 'punch')
})

test('a held attack passes through the normal run and pauses immediately when it earns a level', () => {
  const run = newRun()
  run.start()
  run.combat.xp = levelXP(2) - run.balance.enemies.thug.xp
  const enemy = place(run, 'thug', 0, 1.4, 1)
  setPose(enemy, 'recovery', run.now, 0.25)
  run.update(dt, false, { dash: false })
  assert.equal(run.combat.kills, 1)
  assert.equal(run.phase, 'upgrade')
  const position = run.runner.z
  const time = run.now
  const strike = run.combat.strike
  for (let i = 0; i < 40; i++) run.update(dt, false, { dash: false })
  assert.equal(run.runner.z, position)
  assert.equal(run.now, time)
  assert.equal(run.combat.strike, strike)
})

test('level cards require a new matching pointer gesture after the entry delay', async () => {
  const { UpgradeReveal } = await load('ui/UpgradeReveal')
  const reveal = new UpgradeReveal()
  reveal.start(0)
  assert.equal(reveal.stage(0.349), 'notice')
  assert.equal(reveal.stage(0.35), 'entering')
  reveal.down('steel', 1, 0.52)
  reveal.up('steel', 1)
  assert.equal(reveal.accept('steel', 0.53, false), false)
  assert.equal(reveal.stage(0.53), 'ready')

  reveal.down('steel', 1, 0.54)
  reveal.up('steel', 2)
  assert.equal(reveal.accept('steel', 0.57, false), false)
  reveal.down('steel', 1, 0.58)
  reveal.up('dash', 1)
  assert.equal(reveal.accept('dash', 0.59, false), false)
  reveal.down('steel', 1, 0.60)
  reveal.up('steel', 1)
  assert.equal(reveal.accept('steel', 0.61, false), true)
  assert.equal(reveal.accept('steel', 0.62, false), false)

  reveal.start(1)
  assert.equal(reveal.accept('steel', 1.3, true), false)
  assert.equal(reveal.accept('steel', 1.6, true), true)
})

test('camera height changes vertical perspective independently of horizon, scale and lane', () => {
  const make = (cameraHeight, horizon = defaultWorld.horizon) =>
    new PerspectiveProjector(320, 470, 48, { ...defaultWorld, cameraHeight, horizon }, laneX(-1), 0.8)
  const high = make(1)
  const low = make(0.70)
  assert.equal(defaultWorld.cameraHeight, 0)
  assert.equal(defaultWorld.horizon, 0.50)
  assert.equal(low.horizon, high.horizon)
  const a = high.project(0, 53)
  const b = low.project(0, 53)
  assert.ok(b.y < a.y && b.y > low.horizon)
  assert.equal(b.x, a.x)
  assert.equal(b.scale, a.scale)
  assert.ok(low.project(0, 48).y > low.height)
  const minimum = make(0)
  const mid = make(0.35)
  const nearMinimum = minimum.project(0, 48)
  const farMinimum = minimum.project(0, 53)
  assert.ok(nearMinimum.y > minimum.height && Number.isFinite(nearMinimum.y))
  assert.ok(minimum.horizon < farMinimum.y && farMinimum.y < mid.project(0, 53).y)
  assert.ok(mid.project(0, 53).y < b.y)
  assert.equal(farMinimum.x, a.x)
  assert.equal(farMinimum.scale, a.scale)
  const oldY = height => low.horizon + (470 + 12 - low.horizon) * (3.15 * height / (3.15 * height + 5))
  for (const height of [0.7, 0.85, 1.2]) assert.equal(make(height).project(0, 53).y, oldY(height))
  assert.ok(make(0.70, 0.35).horizon < low.horizon)
})

test('combat emits one primary punch cue per accepted strike, including a manual hook', () => {
  const run = newRun()
  run.start()
  assert.equal(run.tap(), true)
  assert.equal(run.tap(), false)
  assert.deepEqual(run.combat.audioCues, ['punch.miss'])
  for (const [index, expected] of ['punch.hit', 'punch.hit', 'punch.hook'].entries()) {
    run.combat.enemies.length = 0
    run.combat.audioCues.length = 0
    run.now += run.combat.punchInterval + 0.01
    place(run, 'thug')
    if (index === 2) place(run, 'thug', 1, 2.4)
    assert.equal(index === 2 ? run.special('hook') : run.combat.holdAttack(run.runner, run.now), true)
    assert.deepEqual(run.combat.audioCues.filter(cue => cue.startsWith('punch.')), [expected])
  }
})

test('Bulldog cues follow actual attacks, and phase II begins on exactly half HP', () => {
  const run = newRun()
  run.debugBoss()
  const boss = run.combat.boss
  boss.z = run.runner.z + 3
  play(run, 0.1)
  assert.deepEqual(run.combat.audioCues, ['boss.windup'])
  play(run, run.balance.enemies.bulldog.windup + 0.4)
  assert.equal(run.combat.audioCues.filter(cue => cue === 'boss.attack').length, 1)
  assert.equal(run.combat.audioCues.filter(cue => cue === 'boss.jump_back').length, 1)
  assert.equal(run.combat.audioCues.filter(cue => cue === 'player.hurt').length, 1)

  const duel = newRun()
  duel.debugBoss()
  const target = duel.combat.boss
  target.z = duel.runner.z + 2
  target.hp = target.maxHp / 2 + duel.balance.damage
  assert.equal(duel.tap(), true)
  assert.equal(target.bossPhase, 2)
  assert.equal(events(duel.combat, 'rage').length, 1)
})

test('special attacks damage Bulldog without changing his windup, height or position', () => {
  const run = newRun()
  run.debugBoss()
  const { combat, runner, balance } = run
  const boss = combat.boss
  boss.z = runner.z + 2
  boss.hp = boss.maxHp = 1000
  const telegraphUntil = run.now + 1
  setPose(boss, 'telegraph', run.now, 1)
  assert.equal(run.special('hook'), true)
  run.now += balance.specialCooldown
  assert.equal(run.special('uppercut'), true)
  assert.equal(run.swipe(1), true)
  assert.equal(boss.hp, 1000 - balance.damage * (1.5 + 1.25 + 0.7))
  assert.equal(boss.pose, 'telegraph')
  assert.equal(boss.until, telegraphUntil)
  assert.equal(boss.y, 0)
  assert.equal(boss.vz, 0)
})

test('the first eligible yellow stops a fixed-step run before a held punch and waits for one real counter', () => {
  const run = newRun()
  run.start()
  const enemy = place(run, 'thug', 0, 2.1)
  setPose(enemy, 'telegraph', 0, 0.24)
  assert.equal(run.update(dt, false, { dash: true }, true), false)
  assert.equal(run.tutorialTarget, enemy)
  assert.equal(run.combat.strike, undefined)
  const snapshot = [run.now, run.runner.z, enemy.z, enemy.hp, run.combat.hp, run.combat.score, run.combat.xp]
  for (let i = 0; i < 180; i++) run.update(dt, false, { dash: true }, true)
  assert.deepEqual([run.now, run.runner.z, enemy.z, enemy.hp, run.combat.hp, run.combat.score, run.combat.xp], snapshot)
  assert.equal(run.tap(), false)
  assert.equal(run.swipe(1), false)
  assert.equal(run.special('hook'), false)
  assert.equal(run.confirmTutorialCounter(), true)
  assert.equal(run.confirmTutorialCounter(), false)
  assert.equal(enemy.hp, snapshot[3] - run.balance.damage * run.balance.counterDamage)
  assert.equal(enemy.pose, 'stunned')
  assert.equal(run.combat.score, run.balance.counterScore)
  assert.equal(run.combat.counters, 1)
  assert.equal(run.combat.perfect, 0)
  assert.equal(run.combat.audioCues.filter(cue => cue === 'counter.success').length, 1)
  run.update(dt)
  assert.ok(run.now > snapshot[0])
  assert.ok(run.runner.z > snapshot[1])
})

test('skipping training recovers the live enemy without giving damage, points or XP', () => {
  const run = newRun()
  run.start()
  const enemy = place(run, 'quick', 0, 2.5)
  setPose(enemy, 'telegraph', 0, 0.21)
  run.update(dt, false, undefined, true)
  assert.equal(run.tutorialTarget, enemy)
  assert.equal(run.confirmTutorialCounter(true), true)
  assert.equal(enemy.pose, 'recovery')
  play(run, 0.26)
  assert.equal(enemy.hp, 120)
  assert.equal(run.combat.hp, run.balance.hp)
  assert.equal(run.combat.score, 0)
  assert.equal(run.combat.xp, 0)
  assert.equal(run.combat.counters, 0)
})

test('onboarding preserves independent stages and restarts them without deleting records', async () => {
  const { Onboarding, readTutorial } = await load('game/Onboarding')
  const values = new Map([['punchngo.v2.records', 'keep']])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const onboarding = new Onboarding(storage)
  const run = newRun()
  assert.equal(onboarding.showControls, true)
  assert.equal(onboarding.teachCounter, true)
  assert.equal(onboarding.startCountdown(0), true)
  assert.equal(onboarding.startCountdown(0), false)
  assert.deepEqual(readTutorial(storage), { controls: true, counter: false })
  assert.equal(onboarding.count(0.1), 0)
  assert.equal(onboarding.count(0.2), 3)
  assert.equal(onboarding.count(1.2), 2)
  assert.equal(onboarding.count(2.2), 1)
  assert.equal(onboarding.readyToRun(3.17), false)
  assert.equal(run.tap(), false)
  run.update(3)
  assert.equal(run.now, 0)
  assert.equal(onboarding.readyToRun(3.19), true)
  run.start()
  assert.equal(run.combat.strike, undefined)
  onboarding.finishCounter(4, false)
  assert.equal(onboarding.showingSuccess(4.2), true)
  assert.equal(onboarding.showingSuccess(4.9), false)
  assert.deepEqual(readTutorial(storage), { controls: true, counter: true })
  assert.equal(new Onboarding(storage).showControls, false)
  assert.equal(new Onboarding(storage).teachCounter, false)
  onboarding.reset()
  assert.deepEqual(readTutorial(storage), { controls: false, counter: false })
  assert.equal(values.get('punchngo.v2.records'), 'keep')
})

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
    pointer('up', 80, 80, 2, false)
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

test('super dash integrates a capped 1.2 s speed profile, works without a target and shares recovery', () => {
  const run = newRun()
  run.start()
  const { combat, runner, balance } = run
  assert.equal(run.special('superDash'), true)
  assert.equal(combat.strike, undefined)
  assert.equal(runner.spawnSpeed, balance.speed * 2.8)
  assert.equal(run.tap(), false)
  assert.equal(combat.strike, undefined)
  assert.equal(runner.dash, 0)
  assert.equal(run.special('uppercut'), false)
  runner.advance(0.05)
  assert.equal(runner.speed, balance.speed)
  runner.advance(0.15)
  assert.ok(Math.abs(runner.speed - balance.speed * 2.8) < 1e-8)
  assert.equal(run.tap(), true)
  assert.equal(combat.strike.kind, 'punch')
  assert.equal(run.swipe(1), true)
  for (let i = 0; i < 60; i++) {
    runner.launchDash(2)
    runner.advance(dt)
    assert.ok(runner.speed <= balance.speed * 2.8 + 1e-8)
  }
  const expected = balance.speed * (1.2 + 1.8 * (0.8 + 0.15))
  assert.ok(Math.abs(runner.z - expected) < 1e-8)
  assert.equal(runner.superActive, false)
  assert.equal(runner.lane, 1)
  run.now = 1.999
  assert.equal(run.special('uppercut'), false)
  run.now = 2
  assert.equal(run.special('uppercut'), true)
  assert.equal(combat.strike.kind, 'uppercut')
  run.now = 2.699
  assert.equal(run.special('superDash'), false)
  run.now = 2.7
  assert.equal(run.special('superDash'), true)
})

test('super dash sweeps contacts once and keeps the survivor ahead without flight or contact damage', () => {
  const run = newRun()
  const { runner, combat, balance } = run
  balance.chainDepth = 0
  const target = place(run, 'thug', 0, 2, 100)
  const adjacent = place(run, 'thug', 1, 2.2, 100)
  assert.equal(combat.special(runner, 0, 'superDash'), true)
  runner.advance(0.35)
  combat.update(runner, 0.35, 0.35)
  assert.ok(target.z - runner.z > 0.55)
  assert.equal(target.hp, 100 - balance.damage * balance.superDamage)
  assert.equal(adjacent.hp, 100)
  assert.equal(combat.hp, balance.hp)
  assert.equal(target.dashPushed, true)
  assert.equal(target.chain, undefined)
  assert.equal(target.vx, 0)
  runner.advance(dt)
  combat.update(runner, 0.35 + dt, dt)
  assert.deepEqual(events(combat, 'dashImpact').map(event => event.enemy), [target.id])
  assert.equal(combat.hp, balance.hp)

  const duel = newRun()
  const threat = place(duel, 'thug', 0, 1.55, 120)
  setPose(threat, 'telegraph', 0, 0.13)
  duel.combat.special(duel.runner, 0, 'superDash')
  duel.runner.advance(0.14)
  duel.combat.update(duel.runner, 0.14, 0.14)
  assert.equal(threat.dashPushed, true)
  assert.equal(duel.combat.hp, duel.balance.hp)
})

test('super dash collects twelve enemies without inheriting projectile target/depth limits', () => {
  const run = newRun()
  const { runner, combat, balance } = run
  balance.chainTargets = 1
  balance.chainDepth = 0
  const enemies = Array.from({ length: 12 }, (_, i) => place(run, 'thug', 0, 3 + i, 100))
  combat.special(runner, 0, 'superDash')
  for (let i = 1; i <= 60; i++) {
    runner.advance(dt)
    combat.update(runner, i * dt, dt, true)
    const group = combat.dashPush.members
    for (let j = 1; j < group.length; j++) assert.ok(group[j].z - group[j - 1].z >= 0.8 - 1e-8)
  }
  assert.deepEqual(combat.dashPush.members.map(e => e.id), enemies.map(e => e.id))
  assert.deepEqual(events(combat, 'dashImpact').map(e => e.enemy), [enemies[0].id])
  assert.equal(enemies.filter(e => e.hp < 100).length, 1)
  assert.equal(events(combat, 'chain').length, 0)
  for (let i = 61; i <= 72; i++) { runner.advance(dt); combat.update(runner, i * dt, dt, true) }
  assert.ok(enemies.every(e => combat.enemies.includes(e) && e.z > runner.z && !e.dashPushed && e.vz === 0))
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

test('a full-frame body crossing pushes from the impact point without slowing the runner', () => {
  const settings = { ...balance(), speed: 20, bossAt: 7 }
  const run = newRun(1, settings)
  const empty = newRun(1, settings)
  run.start()
  empty.start()
  const enemy = place(run, 'thug', 0, 1)
  run.update(0.1)
  empty.update(0.1)
  const [bump] = events(run.combat, 'bodyContact')
  assert.equal(bump?.enemy, enemy.id)
  assert.ok(bump.z > enemy.previousZ - 0.06 && bump.z < run.runner.z)
  assert.ok(enemy.z < run.runner.z && Math.abs(enemy.x - run.runner.x) >= 0.86)
  assert.equal(run.combat.hp, 95)
  assert.equal(enemy.hp, 120)
  assert.deepEqual([run.runner.z, run.runner.speed], [empty.runner.z, empty.runner.speed])
})

test('lane movement finds lateral body contact but lets a high airborne enemy pass', () => {
  const run = newRun(1, { ...balance(), bossAt: 7 })
  run.start()
  const grounded = place(run, 'quick', 1, 1.05)
  const high = place(run, 'quick', 1, 1.05)
  high.y = 2
  setPose(high, 'airborne', run.now, 0.4)
  assert.equal(run.runner.changeLane(1), true)
  run.update(0.18)
  assert.deepEqual(events(run.combat, 'bodyContact').map(event => event.enemy), [grounded.id])
  assert.equal(high.x, laneX(1))
  for (let i = 0; i < 12 && grounded.z > run.runner.z; i++) run.update(dt)
  assert.ok(grounded.z <= run.runner.z && Math.abs(grounded.x - run.runner.x) >= 0.86 - 1e-8)
  assert.equal(run.combat.hp, 95)
})

test('a contact cannot repeat through a held overlap; a later separate encounter can register', () => {
  const run = newRun()
  const { combat, runner } = run
  const enemy = place(run, 'thug', 0, 0.48)
  setPose(enemy, 'recovery', 0, 10)
  combat.update(runner, dt, dt)
  assert.equal(events(combat, 'bodyContact').length, 1)
  enemy.x = enemy.vx = enemy.vz = 0
  enemy.z = 0.48
  enemy.flightUntil = 0
  setPose(enemy, 'recovery', dt, 10)
  combat.update(runner, 1.3, dt)
  assert.equal(combat.hp, 95)
  assert.equal(events(combat, 'bodyContact').length, 1)
  enemy.z = 1.2
  combat.update(runner, 1.4, dt)
  enemy.z = 0.48
  combat.update(runner, 1.5, dt)
  assert.equal(events(combat, 'bodyContact').length, 2)
  assert.equal(combat.hp, 90)
})

test('a body shove transfers momentum without damaging either enemy or awarding points', () => {
  const run = newRun(1, { ...balance(), bossAt: 7 })
  run.start()
  const source = place(run, 'thug', 0, 0.72)
  const neighbor = place(run, 'quick', -1, 0.93)
  setPose(neighbor, 'recovery', 0, 1)
  play(run, 0.3)
  assert.deepEqual(events(run.combat, 'bodyContact').map(event => event.enemy), [source.id])
  assert.deepEqual(events(run.combat, 'bodyShove').map(event => event.enemy), [neighbor.id])
  assert.ok(neighbor.x < laneX(-1))
  assert.equal(source.hp, 120)
  assert.equal(neighbor.hp, 120)
  assert.deepEqual([run.combat.hp, run.combat.combo, run.combat.score, run.combat.xp], [95, 0, 0, 0])
})

test('outer-lane brute resists the impulse but leaves the swept path inside the road edge', () => {
  const velocities = ['thug', 'brute'].map(type => {
    const run = newRun(1, { ...balance(), speed: 20, bossAt: 7 })
    run.start()
    run.runner.changeLane(1)
    run.update(0.18)
    const enemy = place(run, type, 1, 1)
    enemy.x += 0.08
    setPose(enemy, 'recovery', run.now, 1)
    run.update(0.1)
    assert.equal(events(run.combat, 'bodyContact').length, 1)
    assert.ok(enemy.x >= run.runner.x + 0.86 - 1e-8 && enemy.x <= 2.55)
    assert.equal(run.combat.hp, 100 - run.balance.enemies[type].contact)
    return Math.abs(enemy.vx)
  })
  assert.ok(velocities[1] < velocities[0])
})

test('at high dash speed preparation uses body contact and every powered survivor joins without shoving', () => {
  const run = newRun(1, { ...balance(), speed: 20, superSpeed: 5, chainDepth: 0, bossAt: 7 })
  run.start()
  const before = place(run, 'thug', 0, 0.9)
  const struck = place(run, 'thug', 0, 3.4)
  const overflow = place(run, 'thug', 0, 4.6)
  assert.equal(run.special('superDash'), true)
  run.update(0.18)
  const impacts = run.combat.events.filter(event => event.kind === 'bodyContact' || event.kind === 'dashImpact')
  assert.deepEqual(impacts.map(event => [event.kind, event.enemy]), [
    ['bodyContact', before.id], ['dashImpact', struck.id],
  ])
  assert.equal(struck.hp, 108)
  assert.equal(overflow.hp, 120)
  assert.equal(before.hp, 120)
  assert.equal(run.combat.hp, 95)
  assert.equal(run.runner.speed, 100)
  assert.ok(Math.abs(before.x - run.runner.x) >= 0.86)
  for (const enemy of [struck, overflow]) {
    assert.ok(enemy.z > run.runner.z)
    assert.equal(enemy.dashPushed, true)
    assert.ok(run.combat.enemies.includes(enemy))
  }
  play(run, 0.55, true)
  assert.ok([struck, overflow].every(e => run.combat.enemies.includes(e) && e.z > run.runner.z))
  assert.deepEqual([run.combat.kills, run.combat.xp, run.combat.score], [0, 0, 0])
})

test('catching up with a low flying punched enemy clears its path without a second injury or losing its chain', () => {
  const run = newRun(1, { ...balance(), speed: 20, bossAt: 7 })
  run.start()
  const target = place(run, 'thug', 0, 1)
  run.tap()
  const chain = target.chain
  run.update(0.1)
  assert.deepEqual(events(run.combat, 'bodyShove').map(event => event.enemy), [target.id])
  assert.equal(events(run.combat, 'bodyContact').length, 0)
  assert.equal(target.chain, chain)
  assert.equal(run.combat.hp, 100)
  assert.ok(Math.abs(target.x - run.runner.x) >= 0.86)
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

test('a dash survivor remains ahead without XP, while a first-contact knockout can level up', () => {
  const run = newRun(1, { ...balance(), bossAt: 7 })
  run.start()
  const enemy = run.combat.spawn('thug', 0, 2, run.now)
  assert.equal(run.special('superDash'), true)
  play(run, 1.2, true)
  assert.deepEqual(events(run.combat, 'dashImpact').map(event => event.enemy), [enemy.id])
  assert.equal(enemy.hp, 21) // 33 HP minus 12 dash damage.
  assert.equal(run.combat.enemies.includes(enemy), true)
  assert.ok(enemy.z > run.runner.z)
  assert.deepEqual([run.combat.xp, run.combat.kills, run.combat.score], [0, 0, 0])

  play(run, 0.85, true)
  const target = place(run, 'thug', 0, 2, 12)
  run.combat.xp = levelXP(2) - run.balance.enemies.thug.xp
  assert.equal(run.special('superDash'), true)
  play(run, 0.4, true)
  assert.equal(target.hp, 0)
  assert.equal(run.phase, 'upgrade')
  assert.deepEqual([run.combat.xp, run.combat.kills, run.combat.score], [levelXP(2), 1, 100])
})

test('all direct strikes and secondary effects grant the victim’s XP exactly once on knockout', async t => {
  const scenarios = [
    ['tap', 0, run => run.tap()],
    ['hold', 0, run => run.update(dt, true, { dash: true })],
    ['left swipe', -1, run => run.swipe(-1)],
    ['right swipe', 1, run => run.swipe(1)],
    ['uppercut', 0, run => {
      run.special('uppercut')
      play(run, 0.2, true)
    }],
    ['ordinary counter', 0, (run, target) => {
      setPose(target, 'telegraph', 0, 1)
      run.now = 0.84
      run.tap()
    }],
    ['perfect counter', 0, (run, target) => {
      setPose(target, 'telegraph', 0, 1)
      run.now = 0.965
      run.tap()
    }],
    ['dash shockwave', 1, run => {
      run.combat.take('wave')
      run.special('superDash')
      play(run, 0.35, true)
    }],
    ['electric discharge', 1, run => {
      run.balance.chainDepth = 0
      run.combat.take('electric')
      place(run, 'thug', 0, 1.9)
      run.special('superDash')
      play(run, 0.35, true)
    }],
    ['chain collision', 0, (run, target) => {
      target.z = 4.2
      place(run, 'thug', 0, 1.5)
      run.tap()
      play(run, 0.5, true)
      assert.equal(events(run.combat, 'chain').length, 1)
    }],
    ['fire damage', 0, (run, target) => {
      target.hp = 25
      run.combat.take('fire')
      run.tap()
      assert.equal(run.combat.xp, 0)
      assert.equal(target.hp, 1)
      play(run, 0.4, true)
    }],
    ['uppercut landing wave', 1, (run, target) => {
      run.balance.uppercutChainDepth = 0
      run.combat.take('uppercut')
      const source = place(run, 'thug', 0, 1.7)
      setPose(target, 'stunned', run.now, 2)
      run.special('uppercut')
      for (let i = 0; i < 65; i++) {
        if (source.vy < 0 && source.y > 0 && source.y < 0.27) target.z = source.z + 0.2
        run.update(dt, true)
      }
      assert.equal(events(run.combat, 'landing').length, 1)
    }],
  ]
  for (const [name, lane, strike] of scenarios) await t.test(name, () => {
    const run = newRun(1, { ...balance(), bossAt: 7 })
    run.start()
    const target = place(run, 'quick', lane, 2, 8)
    strike(run, target)
    assert.equal(target.hp, 0)
    const { xp, score } = run.balance.enemies.quick
    assert.equal(run.combat.xp, xp)
    assert.equal(run.combat.kills, 1)
    assert.ok(run.combat.score >= score)
    play(run, 1.5, true)
    assert.equal(run.combat.xp, xp)
    assert.equal(run.combat.kills, 1)
  })
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

test('dash wave captures adjacent lanes without damage and electricity discharges once separately', () => {
  const run = newRun()
  const { combat, runner } = run
  run.balance.chainDepth = 0
  for (const id of ['wave', 'electric', 'fire']) combat.take(id)
  const center = place(run, 'thug', 0, 2.3, 400)
  const left = place(run, 'thug', -1, 2.7, 400)
  const right = place(run, 'thug', 1, 3.0, 400)
  combat.special(runner, 0, 'superDash')
  for (let i = 1; i <= 26; i++) { runner.advance(dt); combat.update(runner, i * dt, dt, true) }
  assert.ok(center.hp < 400 && left.hp < 400)
  assert.equal(right.hp, 400)
  assert.equal(right.dashPushed, true)
  assert.equal(events(combat, 'electric').length, 1)
  assert.equal(events(combat, 'electric')[0].enemy, left.id)
  assert.deepEqual(events(combat, 'dashImpact').map(e => e.enemy), [center.id])
  assert.equal(events(combat, 'fire').filter(e => e.enemy === center.id).length, 1)
})

test('uppercut hits at thrust, alternates independently and causes a forceful sequential ricochet', () => {
  const run = newRun()
  const { combat, runner, balance } = run
  balance.chainTargets = 3
  const first = place(run, 'thug', 0, 1.7, 400)
  const second = place(run, 'thug', 0, 4.5, 400)
  const third = place(run, 'thug', 0, 7.3, 400)
  const fourth = place(run, 'thug', 0, 10.1, 400)
  combat.special(runner, 0, 'uppercut')
  assert.equal(combat.strike.hand, 'left')
  combat.update(runner, 0.11, dt, true)
  assert.equal(first.hp, 400)
  combat.update(runner, 0.12, dt, true)
  assert.equal(first.hp, 400 - balance.damage * balance.uppercutDamage)
  assert.ok(first.y > 0 && first.vz > balance.knockback * 2)
  const samples = []
  for (let i = 1; i <= 40; i++) {
    combat.update(runner, 0.12 + i * dt, dt, true)
    samples.push(events(combat, 'ricochet').length)
  }
  assert.deepEqual(events(combat, 'ricochet').map(e => e.enemy), [second.id, third.id])
  assert.ok(samples.includes(1) && samples.includes(2))
  assert.equal(third.depth, 2)
  assert.equal(fourth.hp, 400)
  assert.ok(first.z > 7)
  combat.enemies.length = 0
  combat.tap(runner, 0.85)
  combat.tap(runner, 1.12)
  combat.special(runner, 1.15, 'uppercut')
  assert.equal(combat.strike.hand, 'right')
  combat.special(runner, 1.85, 'uppercut')
  assert.equal(combat.strike.hand, 'left')
  const fresh = newRun()
  fresh.combat.special(fresh.runner, 0, 'uppercut')
  assert.equal(fresh.combat.strike.hand, 'left')
})

test('an upgraded uppercut makes one damaging wave on physical landing even if its source was defeated', () => {
  for (const upgraded of [false, true]) {
    const run = newRun()
    const { combat, runner, balance } = run
    balance.uppercutChainDepth = 0
    if (upgraded) combat.take('uppercut')
    const primary = place(run, 'thug', 0, 1.7, 15)
    assert.equal(combat.special(runner, 0, 'uppercut'), true)
    combat.update(runner, balance.uppercutWindup, dt, true)
    assert.equal(primary.hp, 0)
    assert.equal(primary.pose, 'airborne')
    assert.ok(primary.y > 0.04)
    assert.equal(events(combat, 'landing').length, 0)
    let other
    for (let i = 1; i <= 68; i++) {
      if (!other && primary.vy < 0 && primary.y < 0.27 && primary.y > 0) other = place(run, 'thug', 1, primary.z + 0.2, 120)
      combat.update(runner, balance.uppercutWindup + i * dt, dt, true)
    }
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

for (const useSpecials of [false, true]) test('full seeded Park reaches both boss phases and victory ' +
  (useSpecials ? 'using both new special moves' : 'without relying on special moves'), () => {
  const run = newRun(7)
  run.start()
  let tapAt = 0
  let swipeAt = 0
  let choices = 0
  let bossAt = 0
  let phase2 = false
  let supports = false
  let finishedStrike = false
  let dashes = 0
  let uppercuts = 0
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
    if (useSpecials && run.phase === 'park' && !target && !threatening) {
      const brute = combat.enemies.some(e => e.type === 'brute' && e.hp > 0 && e.z - runner.z > 1.15 &&
        e.z - runner.z <= 3.1 && Math.abs(e.x - runner.x) < 0.74)
      if (brute && run.special('uppercut')) { uppercuts++; tapAt = now + 0.16; continue }
      const pack = combat.enemies.filter(e => e.hp > 0 && e.z - runner.z > 5 && e.z - runner.z < 11 &&
        Math.abs(e.x - runner.x) < 0.74).length
      if (pack >= 2 && run.special('superDash')) { dashes++; tapAt = now + 0.16; continue }
    }
    if (target || (!threatening && ready)) {
      run.tap()
      tapAt = now + (target ? 0.29 : 0.34)
    }
  }
  assert.equal(run.phase, 'victory')
  assert.ok(bossAt >= run.balance.bossAt && bossAt < run.balance.bossAt + dt)
  assert.ok(run.now >= 160 && run.now <= 195)
  assert.ok(choices >= (useSpecials ? 3 : 4) && choices <= (useSpecials ? 7 : 6), JSON.stringify({ choices, dashes, uppercuts }))
  assert.ok(phase2 && supports && finishedStrike)
  assert.ok(run.result().kills >= 45)
  assert.ok(run.result().counters >= 8)
  assert.ok(run.result().hp > 0)
  if (!useSpecials) assert.ok(run.result().score >= run.balance.rankB)
  if (useSpecials) assert.ok(dashes > 0 && uppercuts > 0, JSON.stringify({ dashes, uppercuts }))
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

test('three seconds of holding slows real travel without changing the cadence of missed punches', () => {
  const settings = { ...balance(), bossAt: 7 } // No encounters in this test.
  const run = newRun(1, settings)
  const disabled = newRun(1, { ...settings, holdSlowdownPerSecond: 0 })
  run.start()
  disabled.start()
  const strikes = []
  for (let tick = 1; tick <= 315; tick++) {
    const hold = { dash: tick === 1 }
    const attacked = run.update(dt, false, hold)
    assert.equal(attacked, disabled.update(dt, false, hold))
    if (attacked) {
      assert.equal(run.combat.strike.kind, 'punch')
      assert.equal(run.combat.strike.hit, false)
      strikes.push(tick)
    }
    if (tick === 60 || tick === 120 || tick === 180) {
      const seconds = tick / 60
      assert.ok(Math.abs(run.runner.speed - settings.speed * (1 - 0.15 * seconds)) < 1e-8)
      const expectedZ = settings.speed * (seconds - 0.075 * seconds ** 2 + 0.25)
      assert.ok(Math.abs(run.runner.z - expectedZ) < 1e-8)
    }
  }
  assert.equal(strikes.length, 21)
  assert.ok(strikes.slice(1).every((tick, i) => tick - strikes[i] === 15))
  assert.equal(run.runner.speed, settings.speed * 0.25)
  assert.equal(disabled.runner.speed, settings.speed)
  assert.equal(run.now, disabled.now)
})

test('a custom 20% floor still recovers within 200 ms and retains the penalty on rapid re-hold', () => {
  const run = newRun(1, { ...balance(), bossAt: 7, holdSlowdownPerSecond: 50, holdMinSpeedPercent: 20 })
  run.start()
  const hold = { dash: false }
  for (let i = 0; i < 120; i++) run.update(dt, false, hold)
  const { runner, balance: { speed } } = run
  assert.ok(Math.abs(runner.speed - 0.2 * speed) < 1e-8)
  const before = runner.z
  play(run, 0.1)
  assert.ok(Math.abs(runner.speed - 0.6 * speed) < 1e-8)
  assert.ok(Math.abs(runner.z - before - 0.1 * 0.4 * speed) < 1e-8)
  for (let i = 0; i < 6; i++) run.update(dt, false, hold)
  assert.ok(Math.abs(runner.speed - 0.55 * speed) < 1e-8)
  play(run, 0.2)
  assert.ok(Math.abs(runner.speed - speed) < 1e-8)
  run.update(dt, false, hold)
  run.clearInput()
  assert.equal(runner.speed, speed)
})

test('the minimum speed setting supports both a full stop and no slowdown', () => {
  for (const minimum of [0, 100]) {
    const settings = { ...balance(), holdMinSpeedPercent: minimum }
    const runner = new Runner(settings)
    runner.advance(10, true)
    const before = runner.z
    runner.advance(1, true)
    assert.equal(runner.speed, settings.speed * minimum / 100)
    assert.ok(Math.abs(runner.z - before - runner.speed) < 1e-8)
    runner.advance(0.2)
    assert.equal(runner.speed, settings.speed)
  }
})

test('hold penalty never reduces the active super dash and only applies beyond its endpoint', () => {
  const settings = balance()
  const held = new Runner(settings)
  const free = new Runner(settings)
  held.advance(5.25, true)
  assert.equal(held.launchSuper(), true)
  assert.equal(free.launchSuper(), true)
  const start = held.z
  held.advance(0.5, true)
  free.advance(0.5)
  assert.equal(held.speed, free.speed)
  assert.ok(Math.abs(held.z - start - free.z) < 1e-8)
  held.advance(0.8, true)
  free.advance(0.8)
  assert.equal(held.speed, settings.speed * 0.25)
  assert.ok(Math.abs(held.z - start - free.z + settings.speed * 0.075) < 1e-8)
})

test('a nonlethal hit pauses autoattacks only briefly, even during an active enemy attack', () => {
  const run = newRun()
  run.start()
  const enemy = place(run, 'thug', 0, 1.4)
  setPose(enemy, 'telegraph', run.now, dt)
  assert.equal(run.update(dt, false, { dash: false }), false)
  assert.ok(run.combat.hp < run.balance.hp)
  assert.ok(run.runner.speed < run.balance.speed)
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
  assert.equal(run.runner.speed, run.balance.speed)
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

test('move audio reports one dash start, one uppercut windup and one actual heavy impact', () => {
  const run = newRun()
  const { combat, runner } = run
  assert.equal(combat.special(runner, 0, 'superDash'), true)
  assert.equal(combat.special(runner, 0.1, 'superDash'), false)
  assert.deepEqual(combat.audioCues, ['dash.start'])
  runner.advance(2)
  place(run, 'thug', 0, 2, 200)
  assert.equal(combat.special(runner, 2, 'uppercut'), true)
  assert.deepEqual(combat.audioCues, ['dash.start', 'uppercut.windup'])
  combat.update(runner, 2.12, dt, true)
  combat.update(runner, 2.13, dt, true)
  assert.deepEqual(combat.audioCues, ['dash.start', 'uppercut.windup', 'uppercut.impact'])
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

test('dash and uppercut damage Bulldog without interrupting his attack, while counters still work mid-dash', () => {
  const run = newRun()
  run.debugBoss()
  const { combat, runner, balance } = run
  const boss = combat.boss
  boss.z = runner.z + 1.6
  boss.hp = boss.maxHp = 1000
  const until = run.now + 2.65
  setPose(boss, 'telegraph', run.now, 2.65)
  const start = run.now
  assert.equal(run.special('superDash'), true)
  runner.advance(0.16)
  combat.update(runner, start + 0.16, 0, true)
  assert.equal(boss.hp, 1000 - balance.damage * balance.superDamage)
  runner.advance(1.05)
  run.now = start + 2
  boss.z = runner.z + 2
  assert.equal(run.special('uppercut'), true)
  combat.update(runner, run.now + balance.uppercutWindup, 0, true)
  assert.equal(boss.hp, 1000 - balance.damage * (balance.superDamage + balance.uppercutDamage))
  assert.equal(boss.pose, 'telegraph')
  assert.equal(boss.until, until)
  assert.equal(boss.y, 0)
  assert.equal(boss.vz, 0)

  run.now = start + 2.7
  assert.equal(run.special('superDash'), true)
  setPose(boss, 'telegraph', run.now, 0.18)
  assert.equal(run.tap(), true)
  assert.equal(boss.pose, 'stunned')
  assert.equal(runner.superActive, true)
  assert.equal(runner.dash, 0)
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
  assert.equal(run.special('superDash'), false)
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
  assert.deepEqual(readTutorial(storage), { version: 2, controls: true, counter: 'pending', hints: [] })
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
  onboarding.counterFrame(4, 2.5, false, 0.2)
  assert.equal(onboarding.finishCounter(6.69, false), false)
  onboarding.counterFrame(6.7, 2.5, false, 0.2)
  assert.equal(onboarding.finishCounter(6.7, false), true)
  assert.equal(onboarding.showingSuccess(7), true)
  assert.equal(onboarding.showingSuccess(7.5), false)
  assert.deepEqual(readTutorial(storage), { version: 2, controls: true, counter: 'complete', hints: [] })
  assert.equal(new Onboarding(storage).showControls, false)
  assert.equal(new Onboarding(storage).teachCounter, false)
  onboarding.reset()
  assert.deepEqual(readTutorial(storage), { version: 2, controls: false, counter: 'pending', hints: [] })
  assert.equal(values.get('punchngo.v2.records'), 'keep')
})

test('counter gate starts after entrance, waits for every old contact, and has no ready deadline', async () => {
  const { Onboarding, readTutorial } = await load('game/Onboarding')
  const storage = { value: '', getItem() { return this.value }, setItem(_key, value) { this.value = value } }
  const lesson = new Onboarding(storage)
  lesson.counterFrame(0, 2.5, true, 0.2)
  assert.equal(lesson.finishCounter(0.4, true), false)
  assert.ok(lesson.counterFrame(2.699, 2.5, false, 0.2) < 1)
  assert.equal(lesson.counterReady, false)
  assert.equal(lesson.counterFrame(2.7, 2.5, true, 0.2), 1)
  assert.equal(lesson.counterReady, false)
  lesson.counterFrame(3.1, 2.5, false, 0.2)
  assert.equal(lesson.counterReady, true)
  lesson.counterFrame(120, 2.5, false, 0.2)
  assert.equal(lesson.finishCounter(120, true), true)
  assert.equal(lesson.finishCounter(120, false), false)
  assert.equal(readTutorial(storage).counter, 'skipped')
  assert.equal(lesson.showingSuccess(120), false)
})

test('old controls replay once while a completed legacy counter and records stay intact', async () => {
  const { Onboarding, readTutorial } = await load('game/Onboarding')
  const values = new Map([['punchngo.v2.tutorial', '{"controls":true,"counter":true}'], ['punchngo.v2.records', 'keep']])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const onboarding = new Onboarding(storage)
  assert.equal(onboarding.showControls, true)
  assert.equal(onboarding.teachCounter, false)
  assert.deepEqual(readTutorial(storage).hints, [])
  assert.equal(onboarding.startCountdown(0), true)
  assert.equal(new Onboarding(storage).showControls, false)
  assert.equal(new Onboarding(storage).teachCounter, false)
  assert.equal(values.get('punchngo.v2.records'), 'keep')
})

test('context hints select actual opportunities, never block simulation, and remember shown or used actions', async () => {
  const { Onboarding, readTutorial } = await load('game/Onboarding')
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const onboarding = new Onboarding(storage)
  const run = newRun()
  run.start()
  place(run, 'thug', 0, 6)
  place(run, 'thug', 1, 7)
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, 'punch')
  run.update(dt, true)
  assert.equal(run.now, dt)
  assert.equal(run.tap(), true) // A voluntarily accepted punch counts even on a miss.
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, undefined)
  assert.deepEqual(readTutorial(storage).hints, ['punch'])
  run.now = 6
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, 'side')
  run.now = 8.25
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, undefined)
  assert.deepEqual(readTutorial(storage).hints, ['punch', 'side'])
  run.now = 12
  run.combat.enemies.length = 0
  place(run, 'thug', 0, 8)
  place(run, 'thug', 1, 8.5)
  place(run, 'brute', -1, 9)
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, 'superDash')
  onboarding.updateHints(run, true, false)
  assert.equal(onboarding.hint, undefined)
  assert.deepEqual(readTutorial(storage).hints, ['punch', 'side'])
  run.now = 18
  run.combat.enemies.length = 0
  place(run, 'brute', 0, 6)
  onboarding.updateHints(run, true, true)
  assert.equal(onboarding.hint, 'uppercut')
  onboarding.forceHint('side')
  onboarding.updateHints(run, false, true)
  assert.equal(onboarding.hint, 'side')
})

test('tutorial samples one two-second demo at a time, shares the attack motion and does not change a run', async () => {
  const { tutorialDemo } = await load('game/TutorialDemo')
  const { superHandMotion, uppercutHandMotion } = await load('rendering/AttackMotion')
  const run = newRun()
  const snapshot = [run.now, run.runner.z, run.combat.hp, run.combat.xp, run.combat.score, run.combat.enemies.length]
  assert.deepEqual([0, 2, 4, 6, 8].map(t => tutorialDemo(t, run.balance, false).kind),
    ['punch', 'side', 'superDash', 'uppercut', 'punch'])
  assert.equal(tutorialDemo(2.25, run.balance, false).strike.kind, 'sideLeft')
  assert.equal(tutorialDemo(3.25, run.balance, false).strike.kind, 'sideRight')
  assert.equal(tutorialDemo(6.5, run.balance, false).strike.hand, 'left')
  assert.equal(tutorialDemo(14.5, run.balance, false).strike.hand, 'right')
  const dash = tutorialDemo(4.7, run.balance, false)
  assert.ok(dash.z > 0 && superHandMotion(dash.superAge, run.balance) > 0.95)
  assert.ok(superHandMotion(0.06, run.balance) < 0)
  assert.ok(superHandMotion(1.05, run.balance) > 0)
  assert.equal(superHandMotion(1.2, run.balance), 0)
  assert.ok(uppercutHandMotion(0.06, run.balance) < 0)
  assert.ok(uppercutHandMotion(0.22, run.balance) > 0.9)
  assert.ok(uppercutHandMotion(0.42, run.balance) > 0)
  assert.equal(uppercutHandMotion(0.55, run.balance), 0)
  assert.equal(tutorialDemo(4.7, run.balance, true).z, 0)
  assert.deepEqual([run.now, run.runner.z, run.combat.hp, run.combat.xp, run.combat.score, run.combat.enemies.length], snapshot)
})

test('director leaves extra lookahead even during super dash preparation', async () => {
  const { EncounterDirector } = await load('game/EncounterDirector')
  const distances = [false, true].map(superDash => {
    const run = newRun()
    if (superDash) run.runner.launchSuper()
    const spawns = []
    new EncounterDirector(7, run.balance).update(0.5, run.runner, [], (_, _lane, z) => spawns.push(z))
    return Math.min(...spawns)
  })
  assert.ok(distances[1] > distances[0] + 15)
  assert.ok(distances[1] / (defaultBalance.speed * defaultBalance.superSpeed) >= 2)
})

test('four ram members keep HP and IDs; only the first capture is a hit or a combo', () => {
  const run = newRun()
  const { runner, combat } = run
  const group = [3, 4.4, 6.2, 8.5].map((z, i) => place(run, i === 2 ? 'brute' : 'thug', 0, z, 100))
  combat.special(runner, 0, 'superDash')
  for (let i = 1; i <= 55; i++) { runner.advance(dt); combat.update(runner, i * dt, dt) }
  assert.deepEqual(combat.dashPush.members, group)
  assert.deepEqual(group.map(e => e.hp), [88, 100, 100, 100])
  assert.equal(combat.combo, 1)
  assert.deepEqual([combat.kills, combat.xp, combat.score], [0, 0, 0])
  assert.ok(group.every(e => e.dashPushed && !e.chain && e.vx === 0 && e.vz === 0 && e.pose === 'dashPushed'))
})

test('a ram front can capture outside the hero sweep, including several contacts in one step', () => {
  const run = newRun()
  const first = place(run, 'thug', 0, 3, 100)
  const following = [4, 5, 6, 7].map(z => place(run, 'thug', 0, z, 100))
  run.combat.special(run.runner, 0, 'superDash')
  run.runner.advance(0.25)
  run.combat.update(run.runner, 0.25, 0.25)
  // The last enemy is beyond the hero's maximum contact distance at this time.
  assert.ok(following.at(-1).z - run.runner.z > 2.3)
  assert.deepEqual(run.combat.dashPush.members, [first, ...following])
  assert.deepEqual([first, ...following].map(e => e.hp), [88, 100, 100, 100, 100])
  assert.equal(events(run.combat, 'bodyContact').length, 0)
})

test('a lethal first ram contact spends its only hit and does not block further captures', () => {
  const run = newRun()
  const dead = place(run, 'thug', 0, 3, 12)
  const next = place(run, 'thug', 0, 4, 100)
  run.combat.special(run.runner, 0, 'superDash')
  for (let i = 1; i <= 35; i++) { run.runner.advance(dt); run.combat.update(run.runner, i * dt, dt) }
  assert.equal(dead.hp, 0)
  assert.equal(dead.dashPushed, false)
  assert.equal(next.hp, 100)
  assert.deepEqual(run.combat.dashPush.members, [next])
  assert.deepEqual([run.combat.kills, run.combat.xp, run.combat.score], [1, 16, 100])
  assert.deepEqual(events(run.combat, 'dashImpact').map(e => e.enemy), [dead.id])
})

test('tap and hold damage pushed targets at normal cadence; KO preserves the remaining chain without a jump', () => {
  const run = newRun()
  run.start()
  const first = place(run, 'thug', 0, 3, 60)
  const second = place(run, 'thug', 0, 4, 100)
  const third = place(run, 'brute', 0, 5, 150)
  run.special('superDash')
  play(run, 0.3)
  assert.equal(run.tap(), true)
  assert.equal(first.hp, 24)
  assert.equal(first.dashPushed, true)
  assert.equal(first.chain, undefined)
  assert.equal(run.tap(), false)
  for (let i = 0; i < 14; i++) run.update(dt, false, { dash: false })
  assert.equal(first.hp, 24)
  const z = second.z
  run.update(dt, false, { dash: false })
  assert.equal(first.hp, 0)
  assert.equal(first.dashPushed, false)
  assert.equal(first.chain, undefined)
  assert.deepEqual(run.combat.dashPush.members, [second, third])
  assert.equal(run.combat.kills, 1)
  assert.equal(run.combat.xp, 16)
  assert.ok(second.z >= z && second.z - z <= run.runner.speed * dt + 1e-8)
  assert.equal(run.tap(), false)
  for (let i = 0; i < 15; i++) run.update(dt, false, { dash: false })
  assert.equal(second.hp, 76)
  assert.deepEqual([run.combat.kills, run.combat.xp], [1, 16])
})

test('side swipe ejects only its actual target and remaining ram members follow a smooth lane change', () => {
  const run = newRun()
  run.start()
  const group = [3, 4, 5, 6].map(z => place(run, 'thug', 0, z, 100))
  run.special('superDash')
  play(run, 0.35)
  assert.equal(run.swipe(1), true)
  assert.equal(group[0].dashPushed, false)
  assert.equal(group[0].hp, 100 - 12 - run.balance.damage * run.balance.sideDamage)
  assert.ok(group[0].vx > 0 && group[0].chain)
  for (let i = 0; i < 12; i++) {
    const positions = group.slice(1).map(e => ({ x: e.x, z: e.z }))
    run.update(dt, true)
    for (let j = 1; j < group.length; j++) {
      if (!group[j].dashPushed) continue // A real flying strike may hit another participant.
      assert.ok(Math.abs(group[j].x - positions[j - 1].x) <= 0.35)
      assert.ok(group[j].z > run.runner.z)
    }
  }
  assert.ok(run.combat.dashPush.members.length > 0)
  assert.ok(run.combat.dashPush.members.every(e => Math.abs(e.x - run.runner.x) < 0.01))
  assert.equal(events(run.combat, 'dashImpact').length, 1)
})

test('early taps are dropped, holding unlocks after thrust, and forbidden specials never queue', () => {
  const run = newRun()
  run.start()
  const enemy = place(run, 'thug', 0, 3, 400)
  run.special('superDash')
  assert.equal(run.tap(), false)
  assert.equal(run.swipe(1), false)
  assert.equal(run.special('uppercut'), false)
  assert.equal(run.special('superDash'), false)
  for (let i = 0; i < 11; i++) assert.equal(run.update(dt, true, { dash: true }), false)
  assert.equal(enemy.hp, 388)
  assert.equal(run.update(dt, true, { dash: true }), true)
  assert.equal(enemy.hp, 364)
  assert.equal(run.runner.dash, 0)
  play(run, 2.1, true)
  assert.equal(run.combat.uppercutStrike, undefined)
  assert.equal(events(run.combat, 'air').length, 0)
  assert.equal(events(run.combat, 'dashImpact').length, 1)
})

test('release preserves coordinates and HP, removes no survivors and restarts full attack warnings', () => {
  const run = newRun()
  const group = [3, 4, 5, 6].map(z => place(run, 'thug', 0, z, 100))
  run.combat.special(run.runner, 0, 'superDash')
  for (let i = 1; i <= 71; i++) { run.runner.advance(dt); run.combat.update(run.runner, i * dt, dt) }
  const before = group.map(e => ({ x: e.x, z: e.z, hp: e.hp }))
  const awards = [run.combat.xp, run.combat.score, run.combat.kills, run.combat.combo]
  const eventCount = run.combat.events.length
  run.runner.advance(dt)
  run.combat.update(run.runner, 1.2, dt)
  assert.equal(run.combat.dashPush.active, false)
  assert.equal(run.combat.dashPush.members.length, 0)
  for (let i = 0; i < group.length; i++) {
    const enemy = group[i]
    assert.equal(enemy.hp, before[i].hp)
    assert.equal(enemy.x, before[i].x)
    assert.ok(enemy.z - before[i].z >= 0 && enemy.z - before[i].z <= run.balance.speed * dt + 0.01)
    assert.ok(enemy.z - run.runner.z >= 2.3 - 1e-8)
    assert.equal(enemy.dashPushed, false)
    assert.equal(enemy.pose, 'approach')
    assert.equal(enemy.flightUntil, 0)
    assert.deepEqual([enemy.vx, enemy.vz], [0, 0])
    assert.ok(run.combat.enemies.includes(enemy))
  }
  assert.deepEqual([run.combat.xp, run.combat.score, run.combat.kills, run.combat.combo], awards)
  assert.equal(run.combat.events.length, eventCount)
  assert.equal(run.combat.invulnerableUntil, 0)
  run.runner.advance(dt)
  run.combat.update(run.runner, 1.2 + dt, dt)
  assert.equal(group[0].pose, 'telegraph')
  assert.ok(Math.abs(group[0].until - (1.2 + dt + run.balance.enemies.thug.windup)) < 1e-8)
  assert.equal(run.combat.hp, run.balance.hp)
})

test('wave captures converge into one spaced row without moving existing members on join', () => {
  const run = newRun()
  run.combat.take('wave')
  const group = [-1, 0, 1].map(lane => place(run, 'thug', lane, 3, 100))
  run.combat.special(run.runner, 0, 'superDash')
  for (let i = 1; i <= 60; i++) {
    const previous = group.map(e => ({ x: e.x, z: e.z }))
    run.runner.advance(dt)
    run.combat.update(run.runner, i * dt, dt)
    for (let j = 0; j < group.length; j++) {
      assert.ok(Math.abs(group[j].x - previous[j].x) <= 5.25 * dt + 1e-8)
      assert.ok(Math.abs(group[j].z - previous[j].z) <= (run.balance.speed * 2.8 + 6) * dt + 1e-8)
    }
  }
  assert.equal(run.combat.dashPush.members.length, 3)
  assert.ok(group.every(e => Math.abs(e.x - run.runner.x) < 1e-8))
  const sorted = [...group].sort((a, b) => a.z - b.z)
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].z - sorted[i - 1].z >= 0.8 - 1e-8)
  assert.deepEqual(group.map(e => e.hp), [88, 100, 100])
})

test('Bulldog blocks ram travel across lanes, consumes at most one hit and keeps his real attack', () => {
  const run = newRun()
  run.debugBoss()
  const boss = run.combat.boss
  boss.z = run.runner.z + 3
  const start = run.now
  setPose(boss, 'telegraph', start, 0.7)
  run.special('superDash')
  play(run, 0.5)
  assert.equal(boss.dashPushed, false)
  assert.equal(boss.hp, boss.maxHp - 12)
  assert.equal(run.combat.dashPush.members.length, 0)
  assert.ok(boss.z - run.runner.z >= 2.3 - 1e-8)
  const stopped = run.runner.z
  assert.equal(run.swipe(-1), true)
  play(run, 0.1)
  assert.ok(Math.abs(run.runner.z - stopped) < 1e-8)
  assert.equal(run.runner.superActive, true)
  assert.equal(boss.until, start + 0.7)
  play(run, 0.12)
  assert.ok(run.combat.hp < run.balance.hp)
  assert.ok(boss.z > run.runner.z)
  assert.equal(events(run.combat, 'dashImpact').length, 1)
})

test('a ram train stops at Bulldog without a second hit, and counters still interrupt the boss', () => {
  const run = newRun()
  run.debugBoss()
  const boss = run.combat.boss
  boss.z = run.runner.z + 9
  setPose(boss, 'telegraph', run.now, 1)
  const group = [3, 4, 5, 6].map(z => place(run, 'thug', 0, z, 100))
  run.special('superDash')
  play(run, 0.6, true)
  assert.deepEqual(run.combat.dashPush.members, group)
  assert.equal(boss.hp, boss.maxHp)
  assert.ok(boss.z - group.at(-1).z >= 0.9 - 1e-8)
  assert.ok(group[0].z - run.runner.z >= 2.3 - 1e-8)
  const z = run.runner.z
  play(run, 0.1, true)
  assert.ok(Math.abs(run.runner.z - z) < 1e-8)

  // A short train still allows the normal manual boss counter.
  const duel = newRun()
  duel.debugBoss()
  const target = duel.combat.boss
  target.z = duel.runner.z + 2.7
  setPose(target, 'telegraph', duel.now, 0.6)
  duel.special('superDash')
  play(duel, 0.45, true)
  assert.equal(duel.tap(), true)
  assert.equal(target.pose, 'stunned')
  assert.equal(duel.runner.superActive, true)
})

test('defeat, victory and DEV transitions clear push ownership; upgrade pauses preserve it', () => {
  for (const ending of ['defeat', 'victory', 'debugBoss', 'debugPhase', 'upgrade']) {
    const run = newRun()
    if (ending === 'victory' || ending === 'debugPhase') run.debugBoss()
    else run.start()
    const enemy = place(run, 'thug', 0, 3, 100)
    run.special('superDash')
    play(run, 0.25, true)
    assert.equal(enemy.dashPushed, true)
    if (ending === 'defeat') run.combat.hp = 0
    if (ending === 'victory') run.combat.boss.hp = 0
    if (ending === 'debugBoss') run.debugBoss()
    if (ending === 'debugPhase') run.debugPhase(2)
    if (ending === 'upgrade') run.combat.xp = levelXP(2)
    run.update(dt, true)
    if (ending === 'upgrade') {
      assert.equal(run.phase, 'upgrade')
      const snapshot = [enemy.x, enemy.z, run.runner.z, run.runner.superAge]
      run.update(1, true)
      assert.deepEqual([enemy.x, enemy.z, run.runner.z, run.runner.superAge], snapshot)
      run.choose(run.offer[0])
      assert.equal(enemy.dashPushed, true)
    } else {
      assert.equal(enemy.dashPushed, false, ending)
      assert.equal(run.combat.dashPush.members.length, 0, ending)
      assert.equal(run.runner.superActive, false, ending)
    }
  }
})

test('boss appearance preserves the active train and places Bulldog beyond its front', () => {
  const run = newRun(1, { ...balance(), bossAt: 0.5 })
  run.start()
  const group = Array.from({ length: 12 }, (_, i) => place(run, 'thug', 0, 3 + i, 100))
  run.special('superDash')
  play(run, 0.7, true)
  assert.equal(run.phase, 'boss')
  assert.deepEqual(run.combat.dashPush.members, group)
  assert.ok(group.every(e => run.combat.enemies.includes(e)))
  assert.ok(run.combat.boss.z > group.at(-1).z)
})

test('upgrades do not turn passive ram transport into damage or a reward loop', () => {
  const run = newRun()
  run.combat.hp -= 30
  for (const id of upgradeIds) assert.equal(run.combat.take(id), true)
  const group = Array.from({ length: 12 }, (_, i) => place(run, 'brute', 0, 3 + i, 500))
  run.combat.special(run.runner, 0, 'superDash')
  for (let i = 1; i <= 72; i++) { run.runner.advance(dt); run.combat.update(run.runner, i * dt, dt, true) }
  assert.equal(events(run.combat, 'dashImpact').length, 1)
  assert.equal(events(run.combat, 'electric').length, 1)
  assert.ok(events(run.combat, 'fire').length <= 2)
  assert.equal(events(run.combat, 'air').length, 0)
  assert.equal(events(run.combat, 'landing').length, 0)
  assert.deepEqual([run.combat.kills, run.combat.xp], [0, 0])
  assert.ok(group.every(e => e.hp > 0 && run.combat.enemies.includes(e)))
  assert.equal(run.combat.dashPush.members.length, 0)
})

test('ram trajectories, damage and release match at 30, 60 and 120 rendered FPS', async () => {
  const { FrameClock } = await load('game/FrameClock')
  const simulate = fps => {
    const run = newRun()
    run.start()
    const group = Array.from({ length: 12 }, (_, i) => place(run, 'thug', 0, 3 + i, 100))
    run.special('superDash')
    const clock = new FrameClock()
    for (let i = 0; i < fps * 1.2; i++) clock.frame(1000 / fps, 1, step => { run.update(step, true); return true })
    return { z: run.runner.z, group: group.map(e => [e.id, e.x, e.z, e.hp, e.dashPushed]),
      hit: events(run.combat, 'dashImpact'), xp: run.combat.xp, score: run.combat.score }
  }
  assert.deepEqual(simulate(30), simulate(60))
  assert.deepEqual(simulate(120), simulate(60))
})

test('ram remains stable with direct 30/60/120 Hz physics steps and a step crossing its endpoint', () => {
  const simulate = hz => {
    const run = newRun()
    const group = Array.from({ length: 12 }, (_, i) => place(run, 'thug', 0, 3 + i, 100))
    run.combat.special(run.runner, 0, 'superDash')
    for (let i = 1; i <= hz * 1.2; i++) {
      run.runner.advance(1 / hz)
      run.combat.update(run.runner, i / hz, 1 / hz)
      for (let j = 1; j < run.combat.dashPush.members.length; j++) {
        const chain = run.combat.dashPush.members
        assert.ok(chain[j].z - chain[j - 1].z >= 0.8 - 1e-8)
      }
    }
    assert.ok(group.every(e => e.z > run.runner.z + 0.55 && run.combat.enemies.includes(e) && !e.dashPushed))
    assert.deepEqual(group.map(e => e.hp), [88, ...Array(11).fill(100)])
    assert.equal(events(run.combat, 'dashImpact').length, 1)
    assert.equal(run.combat.hp, run.balance.hp)
    return { z: run.runner.z, gaps: group.map(e => e.z - run.runner.z) }
  }
  const base = simulate(60)
  for (const hz of [30, 120]) {
    const result = simulate(hz)
    assert.ok(Math.abs(result.z - base.z) < 1e-8)
    result.gaps.forEach((gap, i) => assert.ok(Math.abs(gap - base.gaps[i]) < 0.04))
  }
  const run = newRun()
  const enemy = place(run, 'thug', 0, 3, 100)
  run.combat.special(run.runner, 0, 'superDash')
  run.runner.advance(1.19)
  run.combat.update(run.runner, 1.19, 1.19)
  run.runner.advance(0.03)
  run.combat.update(run.runner, 1.22, 0.03)
  assert.ok(enemy.z - run.runner.z > 2.1)
  assert.equal(enemy.hp, 88)
  assert.equal(enemy.dashPushed, false)
  assert.equal(run.combat.hp, run.balance.hp)
})

test('burning KO detaches a pushed victim once and promotes the next live target', () => {
  const run = newRun()
  run.combat.take('fire')
  const first = place(run, 'thug', 0, 3, 14)
  const next = place(run, 'thug', 0, 4, 100)
  run.combat.special(run.runner, 0, 'superDash')
  for (let i = 1; i <= 60; i++) { run.runner.advance(dt); run.combat.update(run.runner, i * dt, dt) }
  assert.equal(first.hp, 0)
  assert.equal(first.dashPushed, false)
  assert.deepEqual(run.combat.dashPush.members, [next])
  assert.equal(next.hp, 100)
  assert.deepEqual([run.combat.kills, run.combat.xp, run.combat.score], [1, 16, 100])
  assert.equal(events(run.combat, 'chain').length, 0)
})

test('swept ricochet needs simultaneous body height and planar contact', async () => {
  const { sweepBodies } = await load('combat/sweep')
  assert.ok(Number.isFinite(sweepBodies(0, -3, 1.7, 0, 6, -2, 0.68, 1.1)))
  assert.equal(sweepBodies(0, -3, 2.3, 0, 6, 0, 0.68, 1.1), Infinity)
  assert.equal(sweepBodies(0, -3, 2.3, 0, 6, -1.3, 0.68, 1.1), Infinity)
})

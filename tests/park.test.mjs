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
  run.swipe(1)
  run.swipe(1)
  play(run, 0.20, true)
  assert.equal(run.runner.x, laneX(1))
})

test('gesture capture, swipe suppression, multiple pointers, and blur or visibility cancellation', () => {
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  globalThis.window = new EventTarget()
  globalThis.document = new EventTarget()
  class Canvas extends EventTarget {
    capture
    setPointerCapture(id) { this.capture = id }
    hasPointerCapture(id) { return this.capture === id }
    releasePointerCapture() { this.capture = undefined }
  }
  const canvas = new Canvas()
  const actions = []
  const input = new TouchController(canvas, () => true, () => actions.push('tap'), lane => actions.push(lane))
  const pointer = (type, id, x, y, timeStamp) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: id, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    canvas.dispatchEvent(event)
  }
  try {
    pointer('pointerdown', 1, 80, 80, 0)
    pointer('pointerup', 2, 80, 80, 20)
    pointer('pointerup', 1, 80, 80, 30)
    pointer('pointerdown', 1, 90, 80, 50)
    pointer('pointermove', 1, 46, 82, 75)
    pointer('pointerup', 1, 22, 82, 100)
    pointer('pointerdown', 1, 70, 80, 120)
    pointer('pointerup', 1, 112, 84, 190)
    pointer('pointerdown', 1, 80, 80, 210)
    pointer('pointerup', 1, 80, 125, 240)
    pointer('pointerdown', 1, 80, 80, 260)
    globalThis.window.dispatchEvent(new Event('blur'))
    pointer('pointerup', 1, 80, 80, 310)
    pointer('pointerdown', 1, 80, 80, 320)
    globalThis.document.dispatchEvent(new Event('visibilitychange'))
    pointer('pointerup', 1, 80, 80, 350)
    pointer('pointerdown', 1, 80, 80, 370)
    pointer('pointerup', 1, 80, 80, 410)
    pointer('pointerdown', 1, 80, 80, 450)
    assert.equal(input.isHolding(629), false)
    assert.equal(input.isHolding(630), true)
    pointer('pointerup', 1, 80, 80, 640)
    assert.equal(input.isHolding(641), false)

    pointer('pointerdown', 1, 80, 80, 670)
    assert.equal(input.isHolding(850), true)
    pointer('pointermove', 1, 118, 80, 860)
    assert.equal(input.isHolding(900), false)
    pointer('pointerup', 1, 123, 80, 920)

    pointer('pointerdown', 1, 80, 80, 940)
    assert.equal(input.isHolding(1120), true)
    globalThis.window.dispatchEvent(new Event('blur'))
    assert.equal(input.isHolding(1130), false)
    pointer('pointerup', 1, 80, 80, 1140)
    assert.deepEqual(actions, ['tap', -1, 1, 'tap', 1])
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

test('third successive hit hooks at 150%, then normal cadence resumes; a miss preserves long combo', () => {
  const run = newRun()
  const { combat, runner } = run
  const a = place(run, 'thug', 0, 2, 300)
  const neighbor = place(run, 'thug', 1, 2.3, 300)
  combat.tap(runner, 0)
  assert.equal(combat.strike.hand, 'left')
  combat.tap(runner, 0.25)
  assert.equal(combat.strike.hand, 'right')
  combat.tap(runner, 0.5)
  assert.equal(combat.strike.kind, 'hook')
  assert.equal(a.hp, 300 - run.balance.damage * 3.5)
  assert.ok(neighbor.hp < 300)
  combat.tap(runner, 0.75)
  assert.equal(combat.strike.kind, 'punch')
  const combo = combat.combo
  combat.enemies.length = 0
  combat.tap(runner, 1)
  assert.equal(combat.combo, combo)
  run.start()
  play(run, 0.20)
  assert.equal(combat.combo, combo)
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

test('wave, electricity, fire and uppercut all have real effects together', () => {
  const run = newRun()
  const { combat, runner } = run
  for (const id of ['wave', 'electric', 'fire', 'uppercut']) combat.take(id)
  const primary = place(run, 'thug', 0, 1.8, 400)
  const outer = place(run, 'thug', 1, 3.25, 400)
  const distant = place(run, 'thug', -1, 4.5, 400)
  for (let i = 0; i < 3; i++) combat.tap(runner, i * 0.25)
  assert.ok(outer.hp < 400)
  assert.ok(distant.hp < 400)
  assert.equal(events(combat, 'electric').length, 1)
  assert.ok(events(combat, 'wave').length > 0)
  assert.equal(primary.burnTicks, 4)
  const hp = primary.hp
  combat.update(runner, 0.74, dt, true)
  assert.ok(primary.hp < hp)
  combat.tap(runner, 0.75)
  combat.tap(runner, 1)
  assert.equal(primary.pose, 'airborne')
  assert.ok(primary.vy > 0)
  combat.update(runner, 1.05, dt, true)
  assert.ok(primary.y > 0.04)
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

test('hold repeats at the combat cooldown, dashes on misses and leaves counters to taps', () => {
  const run = newRun()
  const { combat, runner } = run
  combat.take('flurry')
  const interval = combat.punchInterval
  assert.equal(combat.holdAttack(runner, 0), true)
  assert.equal(combat.holdAttack(runner, interval - 0.001), false)
  assert.equal(combat.holdAttack(runner, interval), true)
  assert.equal(events(combat, 'miss').length, 2)
  assert.ok(runner.dash > 0)
  const enemy = place(run)
  setPose(enemy, 'telegraph', 0.5, 0.50)
  assert.equal(combat.holdAttack(runner, 0.6), false)
  assert.equal(combat.holdAttack(runner, 0.96), false)
  assert.equal(combat.counters, 0)
  assert.equal(combat.tap(runner, 0.96), true)
  assert.equal(combat.perfect, 1)
  assert.equal(enemy.pose, 'stunned')
  assert.equal(combat.holdAttack(runner, 0.96 + interval), true)
  assert.equal(combat.counters, 1)
})

test('a held attack passes through the normal run and pauses immediately when it earns a level', () => {
  const run = newRun()
  run.start()
  run.combat.xp = levelXP(2) - run.balance.enemies.thug.xp
  const enemy = place(run, 'thug', 0, 1.4, 1)
  setPose(enemy, 'recovery', run.now, 0.25)
  run.update(dt, false, true)
  assert.equal(run.combat.kills, 1)
  assert.equal(run.phase, 'upgrade')
  const position = run.runner.z
  const time = run.now
  const strike = run.combat.strike
  for (let i = 0; i < 40; i++) run.update(dt, false, true)
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

test('combat emits one primary punch cue for a tap or accepted hold, including a wide hook', () => {
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
    assert.equal(run.combat.holdAttack(run.runner, run.now), true)
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

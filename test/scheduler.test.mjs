/** 调度器单测：不碰进程、不碰窗口，只验证「什么时候响、什么时候停」。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScheduler } from '../lib/scheduler.js'

/** 手动推进的假定时器。 */
function createFakeTimers() {
  let now = 0
  let seq = 0
  const timers = new Map()

  return {
    get now() {
      return now
    },
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { due: now + Math.max(0, ms), fn, interval: 0 })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    setInterval(fn, ms) {
      const id = ++seq
      timers.set(id, { due: now + Math.max(1, ms), fn, interval: Math.max(1, ms) })
      return id
    },
    clearInterval(id) {
      timers.delete(id)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        let pickId = null
        let pick = null
        for (const [id, timer] of timers) {
          if (timer.due <= target && (pick === null || timer.due < pick.due)) {
            pickId = id
            pick = timer
          }
        }
        if (pick === null) break
        now = pick.due
        if (pick.interval > 0) pick.due = now + pick.interval
        else timers.delete(pickId)
        pick.fn()
      }
      now = target
    },
    get size() {
      return timers.size
    },
  }
}

function setup(overrides = {}) {
  const timers = createFakeTimers()
  const calls = { alerts: 0, stops: 0 }
  const scheduler = createScheduler({
    graceMs: 4000,
    repeatMs: 30000,
    timers,
    alert: () => {
      calls.alerts++
    },
    stop: () => {
      calls.stops++
    },
    ...overrides,
  })
  return { timers, calls, scheduler }
}

test('请求在 grace 内被解决时完全不提醒', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  timers.advance(2000)
  scheduler.settle('a')
  timers.advance(60000)
  assert.equal(calls.alerts, 0, '不应该响')
  assert.equal(calls.stops, 0, '没响过就不需要 stop')
  assert.equal(timers.size, 0, '不应留下定时器')
})

test('grace 到期仍未解决时提醒一次', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  timers.advance(3999)
  assert.equal(calls.alerts, 0)
  timers.advance(1)
  assert.equal(calls.alerts, 1, '4 秒后应该响')
  assert.equal(scheduler.alarming, true)
})

test('提醒按 repeatMs 重复，解决后停止', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  timers.advance(4000)
  assert.equal(calls.alerts, 1)
  timers.advance(30000)
  assert.equal(calls.alerts, 2)
  timers.advance(30000)
  assert.equal(calls.alerts, 3)

  scheduler.settle('a')
  assert.equal(calls.stops, 1, '解决后应该撤掉闪烁')
  timers.advance(120000)
  assert.equal(calls.alerts, 3, '解决后不应再响')
  assert.equal(timers.size, 0)
})

test('repeatMs <= 0 时只提醒一次', () => {
  const { timers, calls } = setup({ repeatMs: 0 })
  const scheduler = createScheduler({
    graceMs: 100,
    repeatMs: 0,
    timers,
    alert: () => {
      calls.alerts++
    },
    stop: () => {
      calls.stops++
    },
  })
  scheduler.start('a')
  timers.advance(100)
  assert.equal(calls.alerts, 1)
  timers.advance(180000)
  assert.equal(calls.alerts, 1, '不应重复')
})

test('多个请求：只有全部解决才停闪烁', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  scheduler.start('b')
  timers.advance(4000)
  assert.equal(calls.alerts, 1)

  scheduler.settle('a')
  assert.equal(calls.stops, 0, 'b 还在等，不能停')

  timers.advance(30000)
  assert.equal(calls.alerts, 2, '继续重复提醒')

  scheduler.settle('b')
  assert.equal(calls.stops, 1, '全部解决才停')
})

test('请求在 grace 结束后才来，重新计时而不叠加', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  timers.advance(2000)
  scheduler.start('b')
  timers.advance(2000)
  assert.equal(calls.alerts, 1, 'a 的 grace 到点就该响')

  timers.advance(100000)
  const alertsBefore = calls.alerts
  scheduler.settle('a')
  scheduler.settle('b')
  assert.equal(calls.stops, 1)
  timers.advance(100000)
  assert.equal(calls.alerts, alertsBefore, '都解决后不再响')
})

test('重复 start 同一个 id 不会重复计时', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  scheduler.start('a')
  scheduler.start('a')
  timers.advance(4000)
  assert.equal(calls.alerts, 1)
  assert.equal(scheduler.size, 1)
})

test('dispose 之后不再提醒，并撤掉闪烁', () => {
  const { timers, calls, scheduler } = setup()
  scheduler.start('a')
  timers.advance(4000)
  assert.equal(calls.alerts, 1)

  scheduler.dispose()
  assert.equal(calls.stops, 1, 'dispose 应该停止闪烁')
  timers.advance(120000)
  assert.equal(calls.alerts, 1)
  assert.equal(scheduler.size, 0)
  assert.equal(timers.size, 0)
})

test('alert 抛错不会打断调度', () => {
  const timers = createFakeTimers()
  let thrown = 0
  const scheduler = createScheduler({
    graceMs: 100,
    repeatMs: 0,
    timers,
    alert: () => {
      thrown++
      throw new Error('backend boom')
    },
    stop: () => {},
  })
  scheduler.start('a')
  timers.advance(100)
  assert.equal(thrown, 1)
  assert.doesNotThrow(() => scheduler.settle('a'))
})

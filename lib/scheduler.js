/**
 * 提醒调度：把「有请求在等授权」这件事转成「什么时候响、什么时候停」。
 *
 * 纯逻辑，不碰进程/窗口，方便单测。时间源与后端都可注入。
 *
 * 生命周期：
 *   1. 第一个请求进来 -> 等 graceMs
 *   2. graceMs 后仍有请求未解决 -> 触发 alert()，并在 repeatMs 后重复
 *   3. 所有请求解决 -> 停止重复、调用 stop() 撤掉闪烁
 *
 * 为什么要 grace：用户可能就在窗口前，审批面板已经显示出来，
 * 这时候不需要吵；真正需要提醒的是「等了一会儿还没人理」的场景。
 */

const defaultTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
}

/**
 * @param {object} options
 * @param {number} options.graceMs   请求出现后多久开始提醒（毫秒）
 * @param {number} options.repeatMs  重复提醒间隔；<= 0 表示只提醒一次
 * @param {() => void} options.alert 触发一次提醒
 * @param {() => void} options.stop  停止提醒（撤掉闪烁）
 * @param {object} [options.timers]  可注入的定时器实现
 */
export function createScheduler({ graceMs, repeatMs, alert, stop, timers = defaultTimers }) {
  const pending = new Map()
  let graceTimer = null
  let repeatTimer = null
  let alarming = false
  let disposed = false

  function safe(fn) {
    try {
      fn()
    } catch {
      /* 提醒失败不能反过来影响审批本身 */
    }
  }

  function clearTimers() {
    if (graceTimer !== null) {
      timers.clearTimeout(graceTimer)
      graceTimer = null
    }
    if (repeatTimer !== null) {
      timers.clearInterval(repeatTimer)
      repeatTimer = null
    }
  }

  function fire() {
    if (disposed || pending.size === 0) return
    alarming = true
    safe(alert)
    if (repeatMs > 0 && repeatTimer === null) {
      repeatTimer = timers.setInterval(() => {
        if (disposed || pending.size === 0) return
        safe(alert)
      }, repeatMs)
    }
  }

  function silence() {
    clearTimers()
    if (alarming) {
      alarming = false
      safe(stop)
    }
  }

  function scheduleGrace() {
    if (disposed || graceTimer !== null) return
    graceTimer = timers.setTimeout(() => {
      graceTimer = null
      if (disposed) return
      fire()
    }, Math.max(0, graceMs))
  }

  return {
    /** 一个请求开始等待用户处理。 */
    start(id, meta) {
      if (disposed || pending.has(id)) return
      pending.set(id, meta ?? {})
      if (pending.size === 1) scheduleGrace()
    },

    /** 一个请求已经解决（批准、拒绝、取消或超时）。 */
    settle(id) {
      if (disposed) return
      if (!pending.delete(id)) return
      if (pending.size === 0) silence()
    },

    /** 当前仍在等待的请求数。 */
    get size() {
      return pending.size
    },

    /** 已进入提醒状态（grace 已过且有请求未解决）。 */
    get alarming() {
      return alarming
    },

    dispose() {
      disposed = true
      pending.clear()
      silence()
    },
  }
}

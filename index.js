/**
 * dsh-approval-alert — 待授权提醒。
 *
 * 解决的是：DSH 在等用户批准一个工具调用（或被问一个问题）时，
 * 如果窗口被最小化/关掉/切到其他程序，用户完全收不到信号，任务就卡在那里。
 *
 * 做法：
 * - 监听 Host 的两个"等用户决策"的 waterfall 事件
 *   `approval/request`（工具审批）与 `user-questions/request`（结构化提问）；
 * - 请求出现后等 graceMs，仍然没人处理就提醒：
 *   播放系统提示音 + 让所属进程的任务栏按钮闪烁（FlashWindowEx）；
 * - 用户就在 DSH 窗口前（窗口是前台）时不打扰；
 * - 所有请求都解决后撤掉闪烁。
 *
 * 不依赖任何 `@deepseek-ai/*` 包：profile 里装的插件解析不到它们，一切走 ctx。
 * 提醒由插件自己 spawn 的 powershell.exe 完成（见 lib/win32.js）。
 */

import { fileURLToPath } from 'node:url'
import { createScheduler } from './lib/scheduler.js'
import { createWin32Backend } from './lib/win32.js'

export const name = 'dsh-approval-alert'

/** 出厂的提示音：柔和的三连上行（不是 Windows 的报错音）。 */
const DEFAULT_SOUND = fileURLToPath(new URL('./assets/sounds/chime.wav', import.meta.url))

const DEFAULTS = {
  graceMs: 4000,
  repeatMs: 30000,
  sound: true,
  flash: true,
  processName: 'DeepSeek Harness',
  soundFile: '',
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function readConfig(raw) {
  const cfg = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    graceMs: clampNumber(cfg.graceMs, DEFAULTS.graceMs, 0, 10 * 60 * 1000),
    repeatMs: clampNumber(cfg.repeatMs, DEFAULTS.repeatMs, 0, 60 * 60 * 1000),
    sound: cfg.sound !== false,
    flash: cfg.flash !== false,
    processName:
      typeof cfg.processName === 'string' && cfg.processName.trim() !== ''
        ? cfg.processName.trim()
        : DEFAULTS.processName,
    soundFile: typeof cfg.soundFile === 'string' ? cfg.soundFile.trim() : DEFAULTS.soundFile,
  }
}

export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)

  const log = (level, text) => {
    try {
      const logger = ctx.logger
      if (logger === undefined || typeof logger[level] !== 'function') return
      logger[level](text)
    } catch {
      /* 日志不能反过来打断调用方 */
    }
  }

  if (process.platform !== 'win32') {
    log('info', '[approval-alert] 只有 Windows 有任务栏闪烁后端，当前平台只保留监听。')
    return
  }
  if (!config.sound && !config.flash) {
    log('info', '[approval-alert] sound 和 flash 都关了，插件不做事。')
    return
  }

  const backend = createWin32Backend({
    processName: config.processName,
    sound: config.sound,
    flash: config.flash,
    soundFile: config.soundFile !== '' ? config.soundFile : DEFAULT_SOUND,
  })

  const scheduler = createScheduler({
    graceMs: config.graceMs,
    repeatMs: config.repeatMs,
    alert: () => {
      void backend.alert().then((result) => {
        if (result.ok !== true) {
          log('warn', `[approval-alert] 提醒失败：${result.error ?? result.stderr ?? 'unknown'}`)
        }
      })
    },
    stop: () => {
      void backend.stop().then((result) => {
        if (result.ok !== true) log('warn', `[approval-alert] 停止闪烁失败：${result.error ?? result.stderr ?? 'unknown'}`)
      })
    },
  })

  ctx.effect(() => () => scheduler.dispose())

  let seq = 0

  function track(kind, payload) {
    const id = `${kind}:${++seq}`
    scheduler.start(id, {
      kind,
      tool: typeof payload?.toolName === 'string' ? payload.toolName : undefined,
      reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
    })
    return id
  }

  function forward(kind) {
    return async function (payload, next) {
      const id = track(kind, payload)
      try {
        return await next()
      } finally {
        scheduler.settle(id)
      }
    }
  }

  function listen(eventName, handler) {
    try {
      ctx.on(eventName, handler)
      log('debug', `[approval-alert] 已监听 ${eventName}`)
    } catch (error) {
      log('warn', `[approval-alert] 监听 ${eventName} 失败：${String(error)}`)
    }
  }

  listen('approval/request', forward('approval'))
  listen('user-questions/request', forward('question'))

  // 测试入口：不伪装审批，直接验证「声音 + 任务栏闪烁」这条链路是否通。
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.get('tools')
    if (tools === undefined || typeof tools.register !== 'function') return
    toolsCtx.effect(
      () =>
        tools.register({
          name: 'approval_alert_test',
          description:
            '验证待授权提醒是否工作：mode=alert 播放提示音并闪烁 DSH 任务栏按钮，mode=stop 停止闪烁。只用于自检，不改变任何审批状态。',
          parameters: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['alert', 'stop'], description: 'alert=响铃并闪烁；stop=停止闪烁' },
            },
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                message: { type: 'string' },
                detail: { type: 'string' },
              },
              required: ['message'],
              additionalProperties: true,
            },
            render: (_args, value) => [
              { type: 'text', text: typeof value.message === 'string' ? value.message : '（无输出）' },
            ],
          },
          execute: async (args) => {
            const mode = args?.mode === 'stop' ? 'stop' : 'alert'
            const result = mode === 'stop' ? await backend.stop() : await backend.alert()
            const detail = [result.stdout, result.stderr, result.error].filter((part) => typeof part === 'string' && part !== '').join(' / ')
            if (result.ok === true) {
              const verdict = result.stdout === 'foreground'
                ? 'DSH 窗口当前是前台，按设计不打扰（未响铃、未闪烁）。'
                : result.stdout === 'no-window'
                  ? '已播放提示音；但没有找到可闪烁的 DSH 任务栏窗口（窗口可能已关闭到托盘）。'
                  : result.stdout === 'no-process'
                    ? '没有找到名为 DSH 的进程，未做任何操作。'
                    : mode === 'stop'
                      ? '已停止闪烁。'
                      : '已播放提示音并请求任务栏闪烁。'
              return { ok: true, message: verdict, detail: result.stdout ?? '' }
            }
            return { ok: false, message: `提醒后端执行失败：${detail || 'unknown'}`, detail }
          },
        }),
      'dsh-approval-alert: test tool',
    )
  })
}

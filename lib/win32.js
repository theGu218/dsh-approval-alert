/**
 * Windows 注意力后端：spawn 一次 Windows PowerShell 执行 assets/alert.ps1。
 *
 * 为什么是 PowerShell 而不是原生模块：
 * - 插件进程是 Electron 的 ELECTRON_RUN_AS_NODE 子进程，拿不到 Electron API
 *   （BrowserWindow.flashFrame 用不了），只能用 Win32 的 FlashWindowEx；
 * - 但插件自己 spawn 的子进程不受 DSH 工具沙箱限制，FlashWindowEx 与
 *   SystemSounds 都能正常作用到其他进程的窗口上；
 * - 不需要编译任何东西，Windows 自带 powershell.exe。
 *
 * 脚本自身会判断「DSH 窗口是否已在前台」：是则什么都不做，
 * 所以用户就在窗口前时不会被吵到。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../assets/alert.ps1', import.meta.url))

const ALERT_TIMEOUT_MS = 8000
const STOP_TIMEOUT_MS = 5000

function runPowerShell(args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(result)
    }

    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (error) {
      finish({ ok: false, error: String(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ ok: false, error: String(error) })
    })
    child.on('close', (code) => {
      finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() })
    })

    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish({ ok: false, error: 'timeout', stdout: stdout.trim(), stderr: stderr.trim() })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

/**
 * @param {object} options
 * @param {string} options.processName 目标进程名（Windows 进程名，不含 .exe）
 * @param {boolean} options.sound     是否播放提示音
 * @param {boolean} options.flash     是否闪烁任务栏
 */
export function createWin32Backend({ processName, sound, flash }) {
  const baseArgs = ['-ProcessName', processName, '-SoundCount', sound ? '2' : '0']
  if (!sound) baseArgs.push('-NoSound')
  if (!flash) baseArgs.push('-NoFlash')

  return {
    /** 触发一次提醒（响铃 + 闪烁）；返回脚本结论，便于日志/测试。 */
    alert() {
      return runPowerShell(['-Mode', 'alert', ...baseArgs], ALERT_TIMEOUT_MS)
    },
    /** 撤掉闪烁。 */
    stop() {
      return runPowerShell(['-Mode', 'stop', '-ProcessName', processName], STOP_TIMEOUT_MS)
    },
  }
}

/** 只冒烟用的探针：确认脚本与 powershell.exe 都可用。 */
export function probeRuntime() {
  return runPowerShell(['-Mode', 'stop'], STOP_TIMEOUT_MS)
}

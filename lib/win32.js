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
 * 两个重要行为：
 * - 默认「DSH 在前台也提醒」：DSH 一个窗口里可以有多个会话，
 *   前台是 DSH 不代表用户看到了另一个会话里的审批；
 * - 找不到 DSH 窗口时仍然播放提示音（不会静默错过）。
 * 每次调用的结论都会追加到日志文件，便于事后排查。
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
 * @param {string} [options.processPath] DSH 可执行文件绝对路径（优先按路径匹配进程）
 * @param {boolean} options.sound     是否播放提示音
 * @param {boolean} options.flash     是否闪烁任务栏
 * @param {string} [options.soundFile] 要播放的 WAV；空字符串表示回退系统提示音
 * @param {boolean} [options.quietWhenFocused] DSH 在前台时保持安静（默认 false）
 * @param {string} [options.logFile]   诊断日志路径，空字符串表示不写
 */
export function createWin32Backend({
  processName,
  processPath = '',
  sound,
  flash,
  soundFile = '',
  quietWhenFocused = false,
  logFile = '',
}) {
  const baseArgs = ['-ProcessName', processName, '-SoundCount', sound ? '1' : '0']
  if (processPath !== '') baseArgs.push('-ProcessPath', processPath)
  if (soundFile !== '') baseArgs.push('-SoundFile', soundFile)
  if (!sound) baseArgs.push('-NoSound')
  if (!flash) baseArgs.push('-NoFlash')
  if (quietWhenFocused) baseArgs.push('-QuietWhenFocused')

  function writeLog(mode, result) {
    if (logFile === '') return
    try {
      mkdirSync(dirname(logFile), { recursive: true })
      const status = result.ok === true ? 'ok' : `fail(${result.error ?? result.code ?? '?'})`
      appendFileSync(
        logFile,
        `${new Date().toISOString()}\t${mode}\t${status}\t${result.stdout ?? ''}\t${result.stderr ?? ''}\n`,
        'utf8',
      )
    } catch {
      /* 日志写不进去不能影响提醒 */
    }
  }

  async function call(mode, args, timeoutMs) {
    const result = await runPowerShell(args, timeoutMs)
    writeLog(mode, result)
    return result
  }

  return {
    /** 触发一次提醒（响铃 + 闪烁）。 */
    alert() {
      return call('alert', ['-Mode', 'alert', ...baseArgs], ALERT_TIMEOUT_MS)
    },
    /** 撤掉闪烁。 */
    stop() {
      return call('stop', ['-Mode', 'stop', '-ProcessName', processName, ...(processPath !== '' ? ['-ProcessPath', processPath] : [])], STOP_TIMEOUT_MS)
    },
  }
}

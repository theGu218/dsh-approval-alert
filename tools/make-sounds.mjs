// 合成几个候选提示音（44.1kHz / 16bit / mono WAV），用于试听后挑选。
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RATE = 44100
const OUT = dirname(fileURLToPath(import.meta.url))

function wav(parts, totalDuration, gain = 0.7) {
  const total = Math.max(1, Math.floor(RATE * totalDuration))
  const buf = Buffer.alloc(44 + total * 2)
  const data = new Float32Array(total)
  for (const part of parts) {
    const start = Math.floor(part.at * RATE)
    const length = Math.min(Math.floor(RATE * part.duration), total - start)
    for (let i = 0; i < length; i++) {
      const t = i / RATE
      const env = part.env(t)
      let v = 0
      for (const [freq, amp] of part.partials) v += Math.sin(2 * Math.PI * freq * t) * amp
      data[start + i] += v * env
    }
  }

  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  const scale = peak > 0 ? (gain * 32767) / peak : 0

  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + total * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(RATE, 24)
  buf.writeUInt32LE(RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(total * 2, 40)

  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, (data[i] * scale) / 32767))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/** 柔和包络：4ms 淡入 + 指数衰减 */
function soft(t, tau) {
  const attack = 1 - Math.exp(-t / 0.004)
  return attack * Math.exp(-t / tau)
}

const sounds = {
  // A. 柔和双音（纯五度上行，像"叮—咚"通知）
  'candidate-1-chime': () =>
    wav(
      [
        { at: 0, duration: 0.55, env: (t) => soft(t, 0.22), partials: [[880, 1], [1760, 0.12]] },
        { at: 0.16, duration: 0.65, env: (t) => soft(t, 0.28), partials: [[1318.5, 1], [2637, 0.08]] },
      ],
      0.95,
    ),

  // B. 单音轻铃（长衰减，像敲一下小铃）
  'candidate-2-bell': () =>
    wav(
      [
        { at: 0, duration: 1.1, env: (t) => soft(t, 0.5), partials: [[1046.5, 1], [2093, 0.25], [3139.5, 0.1]] },
      ],
      1.1,
      0.6,
    ),

  // C. 双短音（两声轻轻的"嘟"，最不像报错）
  'candidate-3-pulse': () =>
    wav(
      [
        { at: 0, duration: 0.09, env: (t) => soft(t, 0.035), partials: [[523.25, 1], [1046.5, 0.2]] },
        { at: 0.16, duration: 0.11, env: (t) => soft(t, 0.04), partials: [[659.25, 1], [1318.5, 0.2]] },
      ],
      0.4,
      0.55,
    ),

  // D. 三连上行（叮-叮-叮，轻快）
  'candidate-4-triple': () =>
    wav(
      [
        { at: 0, duration: 0.3, env: (t) => soft(t, 0.1), partials: [[659.25, 1]] },
        { at: 0.1, duration: 0.32, env: (t) => soft(t, 0.11), partials: [[783.99, 1]] },
        { at: 0.2, duration: 0.4, env: (t) => soft(t, 0.14), partials: [[987.77, 1]] },
      ],
      0.65,
      0.6,
    ),
}

mkdirSync(join(OUT, 'candidates'), { recursive: true })
for (const [name, build] of Object.entries(sounds)) {
  const file = join(OUT, 'candidates', `${name}.wav`)
  writeFileSync(file, build())
  console.log(file)
}

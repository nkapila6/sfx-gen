// sfx-gen: generate sound effects from text with a local Stable Audio model.
// Shells out to sa3.cpp's sa3-generate binary. No Python, no API key.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Clip } from '../types'

type Engine = EngineInterface

const PANE = 'sfx'
const PANE_TITLE = 'Sound effects'
const STORE_KEY = 'clips'
const MAX_CLIPS = 50

const clipsRef = { plugin: 'sfx-gen', key: 'clips' } as const
const clips = atom(clipsRef, [])
const pending = atom({ plugin: 'sfx-gen', key: 'pending' } as const, null)
const dismissed = atom({ plugin: 'sfx-gen', key: 'dismissed' } as const, null)

const DEFAULTS = {
  model: 'small-sfx',
  device: 'auto',
  encoding: 'q5_k_m',
  duration: 8,
}

type Config = typeof DEFAULTS & { sa3Dir?: string }
let config: Config = { ...DEFAULTS }

type GenOpts = {
  prompt: string
  duration?: number | string | null
  seed?: number | string | null
  steps?: number | string | null
}

type GenResult =
  | { ok: true; clip: Clip; base64: string }
  | { ok: false; error: string }

const ACCENT = 'green'
const WAVE_WIDTH = 32
const FLAT = '·'.repeat(WAVE_WIDTH)

function pickBinary(root: string) {
  return root ? root + '/build-metal/bin/sa3-generate' : ''
}

// Parse a prompt string, pulling out --duration/--dur, --seed, --steps flags.
function parseArgs(raw: string | undefined) {
  let text = (raw || '').trim()
  const grab = (re: RegExp) => {
    const m = text.match(re)
    if (!m) return null
    text = text.replace(re, ' ').trim()
    return m[1] ?? null
  }
  const duration = grab(/(?:^|\s)--(?:duration|dur)[ =](-?\d+(?:\.\d+)?)/i) ?? grab(/(?:^|\s)-d[ =](\d+(?:\.\d+)?)/i)
  const seed = grab(/(?:^|\s)--seed[ =](\d+)/i)
  const steps = grab(/(?:^|\s)--steps[ =](\d+)/i)
  return { prompt: text, duration, seed, steps }
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sfx'
}

function basename(path: string) {
  return path.split('/').pop() ?? path
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BARS = '▁▂▃▄▅▆▇█'

// No atob or Buffer in the module sandbox, so decode by hand.
function fromBase64(b64: string) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean.charAt(i)) << 18) |
      (B64.indexOf(clean.charAt(i + 1)) << 12) |
      ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] ?? 'A') & 63)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

// Peak per bucket from a PCM16 or float32 wav, drawn as block characters.
function waveform(b64: string, width = WAVE_WIDTH) {
  try {
    const buf = fromBase64(b64)
    const dv = new DataView(buf.buffer)
    let fmt = 1
    let bits = 16
    let pos = 12
    let data = -1
    let size = 0
    while (pos + 8 <= buf.length) {
      const id = String.fromCharCode(dv.getUint8(pos), dv.getUint8(pos + 1), dv.getUint8(pos + 2), dv.getUint8(pos + 3))
      const len = dv.getUint32(pos + 4, true)
      if (id === 'fmt ') {
        fmt = dv.getUint16(pos + 8, true)
        bits = dv.getUint16(pos + 22, true)
      } else if (id === 'data') {
        data = pos + 8
        size = Math.min(len, buf.length - data)
        break
      }
      pos += 8 + len + (len & 1)
    }
    if (data < 0 || (bits !== 16 && !(fmt === 3 && bits === 32))) return ''
    const step = bits / 8
    const count = Math.floor(size / step)
    const per = Math.max(1, Math.floor(count / width))
    const peaks: number[] = []
    for (let b = 0; b < width; b++) {
      let peak = 0
      // stride through the bucket, a sparkline doesn't need every sample
      for (let i = b * per; i < (b + 1) * per && i < count; i += 16) {
        const at = data + i * step
        const v = bits === 16 ? dv.getInt16(at, true) / 32768 : dv.getFloat32(at, true)
        peak = Math.max(peak, Math.abs(v))
      }
      peaks.push(peak)
    }
    const max = Math.max(...peaks) || 1
    return peaks.map(p => BARS[Math.min(7, Math.floor((p / max) * 7.99))]).join('')
  } catch {
    return ''
  }
}

async function firstExisting($: Engine, paths: string[]) {
  for (const p of paths) if (await $.fs.exists(p)) return p
  return null
}

async function saveClips($: Engine, list: Clip[]) {
  try {
    await $.store.set(STORE_KEY, list)
  } catch (err) {
    $.ui.toast('sfx-gen: could not persist clips: ' + errText(err))
  }
}

async function addClip($: Engine, clip: Clip) {
  await update($, clips, list => [...(list ?? []), clip].slice(-MAX_CLIPS))
  await saveClips($, await read($, clips))
}

async function generate($: Engine, opts: GenOpts): Promise<GenResult> {
  const envDir = await $.env.get('SA3_CPP_DIR')
  const sa3Dir = (config.sa3Dir || envDir || '').trim()
  const { model, encoding, device } = config
  const duration = Number(opts.duration ?? config.duration)
  const prompt = (opts.prompt || '').trim()

  if (!prompt) return { ok: false, error: 'empty prompt' }

  const bin =
    (await firstExisting($, [sa3Dir + '/build-metal/bin/sa3-generate', sa3Dir + '/build/bin/sa3-generate'])) ??
    pickBinary(sa3Dir)
  const modelsDir = sa3Dir + '/models'

  if (!(await $.fs.exists(bin))) {
    return { ok: false, error: `sa3-generate not found at ${bin}. Set the sa3_dir config or install sa3.cpp.` }
  }
  if (!(await $.fs.exists(modelsDir))) {
    return { ok: false, error: `models dir not found: ${modelsDir}. Run sa3.cpp's ./models.sh first.` }
  }

  const cwd = await $.session.cwd()
  const id = String(Date.now())
  const outPath = `${cwd}/.sfx-${id}.wav`

  const argv = [
    bin,
    '--model', model,
    '--encoding', encoding,
    '--models-dir', modelsDir,
    '--prompt', prompt,
    '--duration', String(duration),
    '--out', outPath,
  ]
  if (opts.seed != null) argv.push('--seed', String(opts.seed))
  if (opts.steps != null) argv.push('--steps', String(opts.steps))

  const init: { timeoutMs: number; env?: Record<string, string> } = { timeoutMs: 180000 }
  if (device === 'cpu') init.env = { SA3_DEVICE: 'cpu' }

  const started = Date.now()
  $.ui.status(`generating ${duration}s sfx with ${model} (${device})...`)
  await update($, pending, () => ({ prompt, duration, model, device }))

  try {
    let run
    try {
      run = await $.process.run(argv, init)
    } catch (err) {
      return { ok: false, error: `sa3-generate failed to start: ${errText(err)}` }
    }
    if (run.exitCode !== 0) {
      return { ok: false, error: `sa3-generate exited ${run.exitCode}: ${run.stderr || run.stdout}` }
    }

    let bytes
    try {
      bytes = await $.fs.read(outPath, { as: 'bytes' })
    } catch (err) {
      return { ok: false, error: `wrote ${outPath} but could not read it back: ${errText(err)}` }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const clip: Clip = { id, prompt, path: outPath, duration, elapsed, model, at: started, wave: waveform(bytes.base64) }
    await addClip($, clip)
    return { ok: true, clip, base64: bytes.base64 }
  } finally {
    $.ui.status(undefined)
    await update($, pending, () => null)
  }
}

// Shared tail of /sfx and the tool: toast, play, show the pane.
async function announce($: Engine, r: GenResult, play: boolean) {
  if (!r.ok) {
    $.ui.toast('sfx-gen: ' + r.error)
    return
  }
  $.ui.toast(`sfx ready: ${r.clip.prompt} (${r.clip.elapsed}s)`)
  void $.ui.open({ id: PANE, title: PANE_TITLE })
  if (play) await $.audio.play({ base64: r.base64, mime: 'audio/wav' })
}

async function playClip($: Engine, clip: Clip) {
  try {
    const bytes = await $.fs.read(clip.path, { as: 'bytes' })
    await $.audio.play({ base64: bytes.base64, mime: 'audio/wav' })
  } catch (err) {
    $.ui.toast(`sfx-gen: cannot play ${clip.path}: ${errText(err)}`)
  }
}

async function shareClip($: Engine, clip: Clip) {
  const ffmpeg = await firstExisting($, ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'])
  if (!ffmpeg) {
    $.ui.toast('sfx-gen: ffmpeg not found, install it with brew install ffmpeg')
    return
  }
  if (!(await $.fs.exists(clip.path))) {
    $.ui.toast(`sfx-gen: clip is gone: ${clip.path}`)
    return
  }

  const home = await $.env.get('HOME')
  const out = `${home}/Downloads/sfx-${slug(clip.prompt)}-${clip.id}.mp3`
  $.ui.toast('sfx-gen: converting to mp3...')

  try {
    const run = await $.process.run(
      [ffmpeg, '-y', '-loglevel', 'error', '-i', clip.path, '-codec:a', 'libmp3lame', '-q:a', '2', out],
      { timeoutMs: 120000 },
    )
    if (run.exitCode !== 0) {
      $.ui.toast(`sfx-gen: ffmpeg exited ${run.exitCode}: ${run.stderr}`)
      return
    }
  } catch (err) {
    $.ui.toast('sfx-gen: ffmpeg failed: ' + errText(err))
    return
  }

  // A file reference on the clipboard pastes as an attachment in chat apps.
  let copied = false
  try {
    const cp = await $.process.run([
      '/usr/bin/osascript',
      '-e', 'on run argv',
      '-e', 'set the clipboard to (POSIX file (item 1 of argv))',
      '-e', 'end run',
      out,
    ])
    copied = cp.exitCode === 0
  } catch {}

  const where = '~/Downloads/' + basename(out)
  $.ui.toast(copied ? `mp3 saved to ${where} and copied to the clipboard` : `mp3 saved to ${where}`)
}

export const register: Register = (on, options) => {
  if (options.sa3_dir) config.sa3Dir = String(options.sa3_dir)
  if (options.model) config.model = String(options.model)
  if (options.device) config.device = String(options.device)
  if (options.encoding) config.encoding = String(options.encoding)
  if (options.duration != null) config.duration = Number(options.duration)

  on('session.start', async ($, e, next) => {
    // Seed session state from the store once; a hot reload keeps state as is.
    if ((await $.state.get(clipsRef)).version === 0) {
      const saved = await $.store.get(STORE_KEY)
      const list = Array.isArray(saved) ? (saved as Clip[]).slice(-MAX_CLIPS) : []
      await update($, clips, () => list)
      // old clips stay in the pane but don't take over the band
      const last = list[list.length - 1]
      if (last) await update($, dismissed, () => last.id)
    }

    await $.command.register({
      name: 'sfx',
      description: 'Generate a sound effect from a text prompt with a local Stable Audio model',
      argumentHint: '[description] [--duration N] [--seed N]',
    })
    await $.command.register({
      name: 'sfx-pane',
      description: 'Show generated sound effects in a pane',
    })
    await $.tool.register({
      name: 'sfx',
      description:
        'Generate a sound effect from a text prompt using a local Stable Audio model (sa3.cpp). ' +
        'No API key, no Python. Returns the path to a WAV file. Use for foley and SFX: ' +
        '"metal impact with a deep sub boom", "whoosh across the screen", "footsteps on gravel". ' +
        'Keep prompts to one sound each and layer clips for complex scenes.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the sound effect to generate' },
          duration: { type: 'number', description: 'Clip length in seconds (1-30), default from config' },
          seed: { type: 'number', description: 'Random seed for reproducibility' },
          steps: { type: 'number', description: 'Diffusion steps, default 8' },
          play: { type: 'boolean', description: 'Play the generated clip after writing (default true)' },
        },
        required: ['prompt'],
      },
    })
    return next(e)
  })

  on('command.run', { command: 'sfx' }, async ($, e) => {
    const a = parseArgs(e.args)
    if (!a.prompt) return { text: 'usage  /sfx <description> [--duration N] [--seed N]' }
    const r = await generate($, a)
    await announce($, r, true)
    if (!r.ok) return { text: `✗ ${r.error}` }
    const c = r.clip
    // command output is plain text, so draw the box with characters
    const lines = [
      `❯ "${c.prompt}"`,
      c.wave || FLAT,
      `${c.duration}s · ${c.model} · ${c.elapsed}s · ${basename(c.path)}`,
    ]
    const w = Math.max(...lines.map(l => l.length))
    return {
      text: [
        `╭${'─'.repeat(w + 2)}╮`,
        ...lines.map(l => `│ ${l.padEnd(w)} │`),
        `╰${'─'.repeat(w + 2)}╯`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'sfx-pane' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: opened.isPlaced ? 'Sound effects pane opened.' : 'Sound effects pane is waiting for room.' }
  })

  on('tool.call', { tool: 'mcp__sfx-gen__sfx' }, async ($, e) => {
    const input = e as unknown as GenOpts & { play?: boolean }
    const r = await generate($, input)
    await announce($, r, input.play !== false)
    if (!r.ok) return { result: r.error }
    return { result: `Generated ${r.clip.duration}s sound effect "${r.clip.prompt}" in ${r.clip.elapsed}s -> ${r.clip.path}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = (await read($, clips)) ?? []
    const now = await read($, pending)
    // each clip card is 5 rows tall with its border
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 6) / 5))
    const recent = list.slice(-room).reverse()

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={ACCENT} bold>~/sfx</Text>
          <Text dimColor>
            {list.length} clips · {config.model}
          </Text>
        </Box>
        {now && (
          <Box borderStyle="single" borderColor="yellow" paddingX={1}>
            <Text color="yellow" wrap="truncate-end">
              [gen] {now.duration}s "{now.prompt}"...
            </Text>
          </Box>
        )}
        {list.length === 0 && !now && (
          <Text dimColor>
            <Text color={ACCENT}>$ </Text>/sfx a whoosh across the screen
          </Text>
        )}
        {recent.map(clip => (
          <Box key={'row-' + clip.id} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Text wrap="truncate-end">
              <Text color={ACCENT}>❯ </Text>
              <Text bold>{clip.prompt}</Text>
            </Text>
            <Text color={ACCENT}>{clip.wave || FLAT}</Text>
            <Box>
              <Text dimColor>
                {clip.duration}s · {clip.elapsed}s{'  '}
              </Text>
              <Button key={'play-' + clip.id} label="▶ play" onPress={() => void playClip($, clip)} />
              <Text> </Text>
              <Button key={'share-' + clip.id} label="⇪ mp3" onPress={() => void shareClip($, clip)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await read($, pending)
    if (now) {
      return (
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow" wrap="truncate-end">
            [gen] {now.duration}s "{now.prompt}" · {now.model} ({now.device})...
          </Text>
        </Box>
      )
    }

    const list = (await read($, clips)) ?? []
    const last = list[list.length - 1]
    if (!last || (await read($, dismissed)) === last.id) return next(e)

    return (
      <Box borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Text wrap="truncate-end">
          <Text color={ACCENT}>❯ </Text>"{last.prompt}" <Text color={ACCENT}>{last.wave || FLAT}</Text>{' '}
        </Text>
        <Button key="play" label="▶ play" onPress={() => void playClip($, last)} />
        <Text> </Text>
        <Button key="share" label="⇪ mp3" onPress={() => void shareClip($, last)} />
        <Text> </Text>
        <Button key="dismiss" label="✕" role="dismiss" onPress={() => void update($, dismissed, () => last.id)} />
      </Box>
    )
  })
}

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
    const clip: Clip = { id, prompt, path: outPath, duration, elapsed, model, at: started }
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

// WhatsApp treats audio-only mp4 as a document, so render a waveform video track.
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
  const out = `${home}/Downloads/sfx-${slug(clip.prompt)}-${clip.id}.mp4`
  $.ui.toast('sfx-gen: converting to mp4...')

  try {
    const run = await $.process.run(
      [
        ffmpeg, '-y', '-loglevel', 'error',
        '-i', clip.path,
        '-filter_complex', '[0:a]showwaves=s=720x720:mode=cline:colors=white,format=yuv420p[v]',
        '-map', '[v]', '-map', '0:a',
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        out,
      ],
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

  // A file reference on the clipboard pastes as an attachment in WhatsApp desktop.
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

  const where = '~/Downloads/' + out.split('/').pop()
  $.ui.toast(copied ? `mp4 saved to ${where} and copied. Paste it into WhatsApp.` : `mp4 saved to ${where}`)
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
    if (!a.prompt) return { text: 'Usage: /sfx <description> [--duration N] [--seed N]' }
    const r = await generate($, a)
    await announce($, r, true)
    if (!r.ok) return { text: 'sfx-gen: ' + r.error }
    return { text: `sfx-gen: generated ${r.clip.duration}s in ${r.clip.elapsed}s -> ${r.clip.path}\n  "${r.clip.prompt}"` }
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
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6)
    const recent = list.slice(-room).reverse()

    return (
      <Box flexDirection="column">
        {now && (
          <Text color="yellow">
            generating {now.duration}s "{now.prompt}" with {now.model}...
          </Text>
        )}
        {list.length === 0 && !now && <Text dimColor>No clips yet. Try /sfx a whoosh across the screen</Text>}
        {recent.map(clip => (
          <Box key={'row-' + clip.id} flexDirection="column" marginBottom={1}>
            <Text wrap="truncate-end">{clip.prompt}</Text>
            <Box>
              <Text dimColor>
                {clip.duration}s, made in {clip.elapsed}s{' '}
              </Text>
              <Button key={'play-' + clip.id} label="Play" onPress={() => void playClip($, clip)} />
              <Text> </Text>
              <Button key={'share-' + clip.id} label="Share mp4" onPress={() => void shareClip($, clip)} />
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
        <Box>
          <Text color="yellow">
            sfx: generating {now.duration}s "{now.prompt}" with {now.model} ({now.device})...
          </Text>
        </Box>
      )
    }

    const list = (await read($, clips)) ?? []
    const last = list[list.length - 1]
    if (!last || (await read($, dismissed)) === last.id) return next(e)

    return (
      <Box>
        <Text wrap="truncate-end">sfx: "{last.prompt}" {last.duration}s </Text>
        <Button key="play" label="Play" onPress={() => void playClip($, last)} />
        <Text> </Text>
        <Button key="share" label="Share mp4" onPress={() => void shareClip($, last)} />
        <Text> </Text>
        <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => void update($, dismissed, () => last.id)} />
      </Box>
    )
  })
}

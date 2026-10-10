// sfx-gen: generate sound effects from text with a local Stable Audio model.
// Shells out to sa3.cpp's sa3-generate binary. No Python, no API key.

const DEFAULTS = {
  model: 'small-sfx',
  device: 'auto',
  encoding: 'q5_k_m',
  duration: 8,
}

let config = { ...DEFAULTS }

function pickBinary(root) {
  for (const rel of ['build-metal/bin/sa3-generate', 'build/bin/sa3-generate']) {
    if (root) {
      // existence is checked by the caller via $.fs.exists
      return root + '/' + rel
    }
  }
  return ''
}

// Parse a prompt string, pulling out --duration/--dur, --seed, --steps flags.
function parseArgs(raw) {
  const args = { prompt: '', duration: null, seed: null, steps: null }
  let text = (raw || '').trim()
  const grab = (re) => {
    const m = text.match(re)
    if (!m) return null
    text = text.replace(re, ' ').trim()
    return m[1]
  }
  args.duration = grab(/(?:^|\s)--(?:duration|dur)[ =](-?\d+(?:\.\d+)?)/i) ?? grab(/(?:^|\s)-d[ =](\d+(?:\.\d+)?)/i)
  args.seed = grab(/(?:^|\s)--seed[ =](\d+)/i)
  args.steps = grab(/(?:^|\s)--steps[ =](\d+)/i)
  args.prompt = text
  return args
}

async function generate($, opts) {
  const envDir = await $.env.get('SA3_CPP_DIR')
  const sa3Dir = (opts.sa3Dir || config.sa3Dir || envDir || '').trim()
  const model = opts.model || config.model
  const encoding = opts.encoding || config.encoding
  const device = opts.device || config.device
  const duration = Number(opts.duration ?? config.duration)
  const prompt = (opts.prompt || '').trim()

  if (!prompt) return { ok: false, error: 'empty prompt' }

  const bin = pickBinary(sa3Dir)
  const modelsDir = sa3Dir + '/models'

  if (!(await $.fs.exists(bin))) {
    return {
      ok: false,
      error: `sa3-generate not found at ${bin}. Set the sa3_dir config or install sa3.cpp.`,
    }
  }
  if (!(await $.fs.exists(modelsDir))) {
    return { ok: false, error: `models dir not found: ${modelsDir}. Run sa3.cpp's ./models.sh first.` }
  }

  const cwd = await $.session.cwd()
  const outPath = `${cwd}/.sfx-${Date.now()}.wav`

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

  const init = { timeoutMs: 180000 }
  if (device === 'cpu') init.env = { SA3_DEVICE: 'cpu' }

  let run
  try {
    run = await $.process.run(argv, init)
  } catch (err) {
    return { ok: false, error: `sa3-generate failed to start: ${err && err.message ? err.message : err}` }
  }

  if (run.exitCode !== 0) {
    return { ok: false, error: `sa3-generate exited ${run.exitCode}: ${run.stderr || run.stdout}` }
  }

  let bytes = null
  try {
    bytes = await $.fs.read(outPath, { as: 'bytes' })
  } catch (err) {
    return { ok: false, error: `wrote ${outPath} but could not read it back: ${err}` }
  }

  return { ok: true, path: outPath, base64: bytes.base64, duration, prompt }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sfx',
      description: 'Generate a sound effect from a text prompt with a local Stable Audio model',
      argumentHint: '[description] [--duration N] [--seed N]',
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
      isDeferred: false,
    })
    return next(e)
  })

  on('command.run', { command: 'sfx' }, async ($, e) => {
    const a = parseArgs(e.args)
    if (!a.prompt) return { text: 'Usage: /sfx <description> [--duration N] [--seed N]' }
    const r = await generate($, { prompt: a.prompt, duration: a.duration, seed: a.seed, steps: a.steps })
    if (!r.ok) return { text: 'sfx-gen: ' + r.error }
    await $.audio.play({ base64: r.base64, mime: 'audio/wav' })
    return { text: `sfx-gen: generated ${r.duration}s -> ${r.path}\n  "${r.prompt}"` }
  })

  on('tool.call', { tool: 'mcp__sfx-gen__sfx' }, async ($, e) => {
    const r = await generate($, {
      prompt: e.prompt,
      duration: e.duration ?? null,
      seed: e.seed ?? null,
      steps: e.steps ?? null,
    })
    if (!r.ok) return { result: r.error }
    if (e.play !== false) await $.audio.play({ base64: r.base64, mime: 'audio/wav' })
    return { result: `Generated ${r.duration}s sound effect "${r.prompt}" -> ${r.path}` }
  })
}

# sfx-gen

A Claude Code mod that generates sound effects from a text prompt using a local
Stable Audio model. No API key, no Python at inference time.

It shells out to [`sa3.cpp`](https://github.com/betweentwomidnights/sa3.cpp), a
C++/ggml port of Stable Audio 3, and hands the WAV back to Claude (and plays it).

## What it adds

- `/sfx <description> [--duration N] [--seed N]` - generate a sound effect from
  the command line
- A `sfx` tool Claude can call, so Claude can generate foley for a video or
  sound-design task without you prompting each clip

## Prerequisites

1. `git`, `cmake`, and a C++17 compiler on PATH.
2. Build `sa3.cpp`:

```bash
git clone --recurse-submodules https://github.com/betweentwomidnights/sa3.cpp.git
cd sa3.cpp
./build.sh metal   # or: cpu / cuda / vulkan / hip
```

3. Download the model weights (curl only, no Python):

```bash
./models.sh --variant small-sfx --encoding q5_k_m --ae-encoding q5_k_m
```

## Configure

The mod needs `sa3_dir` set to your `sa3.cpp` checkout. Any of these work:

### 1. Per-session flag (simplest, no files changed)

```bash
claude --plugin-dir /Users/nkapila6/dev/cc-mod/sfx-gen
```

Then `/config`, find the `sfx-gen` rows, set `sa3_dir`. The value is stored in
your settings and reused next session.

### 2. Environment variable (works headless, `claude -p` too)

```bash
export SA3_CPP_DIR=/path/to/sa3.cpp
claude --plugin-dir /path/to/sfx-gen
```

`SA3_CPP_DIR` is read at generation time, so it must be exported in the same
shell before launching Claude.

### 3. Persistent install (always-on, no flag)

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/sfx-gen"
  },
  "pluginConfigs": {
    "sfx-gen@inline": {
      "options": {
        "sa3_dir": "/path/to/sa3.cpp"
      }
    }
  }
}
```

`pluginConfigs` keys take the plugin name plus `@inline` for a
`--plugin-dir`/`CLAUDE_CODE_PLUGIN_DIRS` load, and the config values go under
`options`. With this, the mod loads in every session without a flag.

## Config

| Option | Default | Meaning |
|---|---|---|
| `sa3_dir` | (required) | Path to the `sa3.cpp` checkout |
| `model` | `small-sfx` | `small-sfx`, `small-music`, or `medium` |
| `device` | `auto` | `auto`, `cpu`, or `metal` |
| `encoding` | `q5_k_m` | Must match what `models.sh` fetched |
| `duration` | `8` | Default clip length in seconds |

## Usage

```
/sfx a whoosh across the screen
/sfx footsteps on gravel --duration 6 --seed 42
```

Or ask Claude in natural language ("generate a sound effect of a metal impact")
and it will call the `sfx` tool.

## License

MIT. Model weights are under the Stability AI Community License.

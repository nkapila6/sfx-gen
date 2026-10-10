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

## Install

```bash
claude --plugin-dir /path/to/sfx-gen
```

On first enable, point the `sa3_dir` config at your `sa3.cpp` checkout. Or set
`SA3_CPP_DIR` in the environment so the mod works headless (`claude -p`) too.

## Config

| Option | Default | Meaning |
|---|---|---|
| `sa3_dir` | (required) | Path to the `sa3.cpp` checkout |
| `model` | `small-sfx` | `small-sfx`, `small-music`, or `medium` |
| `device` | `auto` | `auto`, `cpu`, or `metal` |
| `encoding` | `q5_k_m` | Must match what `models.sh` fetched |
| `duration` | `8` | Default clip length in seconds |

## License

MIT. Model weights are under the Stability AI Community License.

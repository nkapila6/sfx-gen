---
name: sfx-gen
description: Generate sound effects from text prompts with a local Stable Audio model (sa3.cpp). Use when the user wants a sound effect, foley, whoosh, impact, door creak, notification sound, or any audio clip described in words. Runs locally, no API key, about 1.5s per clip.
user-invocable: true
---

Generate sound effects from a text prompt with the `sfx` CLI (wraps sa3.cpp's sa3-generate locally).

## Prerequisite

The `sfx` CLI must be on `$PATH` (installed by the sfx-gen installer). Verify with `command -v sfx`. If missing, tell the user to run:

    curl -fsSL https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.sh | bash

## Usage

    sfx "a whoosh across the screen"            # 8s clip by default
    sfx "footsteps on gravel" --duration 6
    sfx "metal impact" --seed 42               # reproducible
    sfx "door creak" --play                     # play after generating
    sfx "alarm beep" --out /path/clip.wav       # choose the file

Without `--out` the wav goes to a temp directory; the printed path is the only
reliable way to find it. Pass `--out ./clip.wav` to keep it in the project.

## When to use

- The user asks for a sound effect, foley, or SFX in words.
- A video/animation project needs audio: generate per-event sounds, then place them on the timeline.
- The user wants custom notification sounds (error, done, permission): generate with a seed so it is reproducible.

## Notes

- Binary and weights live in `~/.claude/sa3` (override with `SFX_SA3_DIR`).
- Default model `small-sfx`; set `SFX_MODEL` for `small-music` or `medium`.
- macOS plays with `afplay`; Linux needs `ffplay` (ffmpeg) for `--play`.

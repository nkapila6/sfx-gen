# sfx-gen

Sound effects from a text prompt, inside Claude Code. Runs a local Stable Audio
model through [sa3.cpp](https://github.com/betweentwomidnights/sa3.cpp): no API
key, no Python, about 1.5s for an 8s clip on Apple Silicon. macOS, Linux, Windows.

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.ps1 | iex
```

Nothing gets compiled. It downloads a prebuilt sa3.cpp (checksum verified),
fetches the weights from HuggingFace (~1 GB, into `~/.claude/sa3`), and installs
the plugin. Safe to re-run. macOS and Windows use sa3.cpp's own releases; Linux
(x86_64, arm64, glibc 2.35+) uses a CPU build hosted on this repo's releases,
so expect ~5-10s per clip there instead of ~1.5s on Apple Silicon.

## Use

```
/sfx a whoosh across the screen
/sfx footsteps on gravel --duration 6 --seed 42
/sfx-pane                                   this session's clips, play, mp3
/sfx-pane history                           toggle older clips
/sfx-notify error a blood-curdling scream   sound for failed tool calls
```

Or just ask Claude ("make me a door creak", "use a doorbell when you need me").
It calls the `sfx` tool, and `notify_on` assigns the clip to an event.

`/sfx-notify` events: `error` (a tool call failed), `permission` (Claude is
waiting on you), `done` (reply finished), `abort` (you interrupted), `compact`.
`/sfx-notify` alone lists them, `<event> test` plays one, `<event> off` clears
it, `off`/`on` mutes everything. The sounds live in `~/.claude/sfx-gen` and
play instantly since they're generated once.

The mp3 button needs `ffmpeg`. It copies the file to the clipboard on macOS,
Windows, and Linux with `wl-copy` or `xclip`.

## Config

Change with `claude plugin configure sfx-gen@sfx-gen`.

| Option | Default | |
|---|---|---|
| `sa3_dir` | `~/.claude/sa3` via the installer | folder with `build/bin/sa3-generate` and `models/` |
| `model` | `small-sfx` | `small-sfx`, `small-music`, `medium` |
| `device` | `auto` | `auto`, `cpu`, `metal` |
| `encoding` | `q5_k_m` | must match the downloaded weights |
| `duration` | `8` | default clip length in seconds |

Hacking on it: `claude --plugin-dir /path/to/sfx-gen` with your own sa3.cpp
build, or set `SA3_CPP_DIR`.

MIT. Model weights are under the Stability AI Community License.

import { tool } from "@opencode-ai/plugin"
import { execFileSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// sfx-gen tool for OpenCode: generate a sound effect from a text prompt with a
// local Stable Audio model (sa3.cpp). No API key, no Python, ~1.5s per clip.

function sfxCli(): string {
  // the sfx-gen installer puts the wrapper here and on PATH for common shells
  const candidates = [
    join(homedir(), ".local", "bin", "sfx"),
    join(homedir(), "bin", "sfx"),
    "/opt/homebrew/bin/sfx",
    "/usr/local/bin/sfx",
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return "sfx"
}

export default tool({
  description:
    "Generate a sound effect from a text prompt using a local Stable Audio model (sa3.cpp). " +
    "No API key, no Python. Returns the path to a WAV file. Use for foley and SFX: " +
    '"metal impact with a deep sub boom", "whoosh across the screen", "footsteps on gravel". ' +
    "Keep prompts to one sound each and layer clips for complex scenes.",
  args: {
    prompt: tool.schema.string().describe("Text description of the sound effect to generate"),
    duration: tool.schema.number().optional().describe("Clip length in seconds (1-30), default 8"),
    seed: tool.schema.number().optional().describe("Random seed for reproducibility"),
    play: tool.schema.boolean().optional().describe("Play the generated clip after writing (default false)"),
  },
  async execute(args) {
    try {
      const cli = sfxCli()
      const argv = [cli, args.prompt]
      if (args.duration != null) argv.push("--duration", String(args.duration))
      if (args.seed != null) argv.push("--seed", String(args.seed))
      if (args.play === true) argv.push("--play")
      const out = execFileSync(argv[0], argv.slice(1), {
        encoding: "utf-8",
        timeout: 200000,
        maxBuffer: 1024 * 1024,
      })
      const path = out.split("\n").filter(l => l.trim().startsWith("/")).pop()?.trim()
      return path ? `Generated sound effect -> ${path}` : out.slice(0, 2000)
    } catch (e: unknown) {
      // execFileSync throws with stdout/stderr attached; narrow without any
      const detail =
        typeof e === "object" && e !== null && "stdout" in e && typeof e.stdout === "string"
          ? `${e.stdout}\n`
          : ""
      const msg = e instanceof Error ? e.message : String(e)
      return `sfx failed: ${detail}${msg}`
    }
  },
})
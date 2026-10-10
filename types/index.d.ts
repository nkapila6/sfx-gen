export type Clip = {
  id: string
  prompt: string
  path: string
  duration: number
  elapsed: string
  model: string
  at: number
}

export type Pending = { prompt: string; duration: number; model: string; device: string }

declare module 'claude-code' {
  interface PluginState {
    'sfx-gen': {
      clips: Clip[]
      pending: Pending | null
      // id of the last clip the band was dismissed for
      dismissed: string | null
    }
  }
}

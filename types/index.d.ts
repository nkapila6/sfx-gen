export type Clip = {
  id: string
  prompt: string
  path: string
  duration: number
  elapsed: string
  model: string
  at: number
  // unicode sparkline of the clip's loudness, cached so the pane needn't reread the wav
  wave?: string
}

export type Pending = { prompt: string; duration: number; model: string; device: string }

declare module 'claude-code' {
  interface PluginState {
    'sfx-gen': {
      clips: Clip[]
      pending: Pending | null
      // id of the last clip the band was dismissed for
      dismissed: string | null
      // pane shows clips from before this session only when toggled on
      showHistory: boolean
      // when this session started; older clips count as history
      since: number
    }
  }
}

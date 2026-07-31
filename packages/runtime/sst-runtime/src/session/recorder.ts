// session/recorder.ts — captures every mutation + twin read + state
// snapshot during a session. The recording is the evidence artifact
// for certification: it proves what happened, when, and what the
// verdict was.
//
// TODO 18: the replayer reconstructs the session from a recording.

export interface RecordedMutation {
  atS: number
  mutation: string
  args: Record<string, unknown>
}

export interface RecordedRead {
  atS: number
  channel: '/twin' | '/world'
  field: string
  value: unknown
}

export interface RecordedVerdict {
  atS: number
  loadKg: number
  indicationKg: number
  errorKg: number
  mpeKg: number
  verdict: string
}

export interface SessionRecording {
  sessionId: string
  instanceId: string
  kindId: string
  startedAt: string
  mutations: RecordedMutation[]
  reads: RecordedRead[]
  verdicts: RecordedVerdict[]
}

export class SessionRecorder {
  #recording: SessionRecording

  constructor(sessionId: string, instanceId: string, kindId: string) {
    this.#recording = {
      sessionId, instanceId, kindId,
      startedAt: new Date().toISOString(),
      mutations: [], reads: [], verdicts: [],
    }
  }

  recordMutation(atS: number, mutation: string, args: Record<string, unknown>): void {
    this.#recording.mutations.push({ atS, mutation, args })
  }

  recordRead(atS: number, channel: '/twin' | '/world', field: string, value: unknown): void {
    this.#recording.reads.push({ atS, channel, field, value })
  }

  recordVerdict(v: RecordedVerdict): void {
    this.#recording.verdicts.push(v)
  }

  getRecording(): SessionRecording { return this.#recording }

  toJSON(): string { return JSON.stringify(this.#recording, null, 2) }
}

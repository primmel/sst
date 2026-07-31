import { describe, it, expect } from 'vitest'
import { SessionRecorder } from '../src/session/recorder.js'

describe('TODO 18 — session persistence (recorder)', () => {
  it('captures mutations, reads, and verdicts', () => {
    const rec = new SessionRecorder('session-1', 'acme-lc500', 'primmel-sst-r60')
    rec.recordMutation(0, 'placeLoad', { massKg: 40 })
    rec.recordMutation(30, 'advanceTime', { seconds: 300 })
    rec.recordRead(35, '/twin', 'indication', { value: 40.05, unit: 'kg' })
    rec.recordRead(35, '/world', 'groundTruth', { appliedLoadKg: 40 })
    rec.recordVerdict({ atS: 35, loadKg: 40, indicationKg: 40.05, errorKg: 0.05, mpeKg: 0.029, verdict: 'conforming' })

    const recording = rec.getRecording()
    expect(recording.sessionId).toBe('session-1')
    expect(recording.instanceId).toBe('acme-lc500')
    expect(recording.mutations).toHaveLength(2)
    expect(recording.reads).toHaveLength(2)
    expect(recording.verdicts).toHaveLength(1)
    expect(recording.verdicts[0]!.verdict).toBe('conforming')
  })

  it('serializes to JSON for evidence export', () => {
    const rec = new SessionRecorder('session-2', 'acme-lc500', 'primmel-sst-r60')
    rec.recordMutation(0, 'placeLoad', { massKg: 200 })
    const json = rec.toJSON()
    const parsed = JSON.parse(json)
    expect(parsed.sessionId).toBe('session-2')
    expect(parsed.mutations[0].mutation).toBe('placeLoad')
    expect(parsed.mutations[0].args.massKg).toBe(200)
  })

  it('captures a failing verdict (lying-twin scenario)', () => {
    const rec = new SessionRecorder('session-3', 'acme-lc500', 'primmel-sst-r60')
    rec.recordVerdict({ atS: 0, loadKg: 40, indicationKg: 40.25, errorKg: 0.25, mpeKg: 0.029, verdict: 'non-conforming' })
    const recording = rec.getRecording()
    expect(recording.verdicts[0]!.verdict).toBe('non-conforming')
    expect(recording.verdicts[0]!.errorKg).toBeGreaterThan(recording.verdicts[0]!.mpeKg)
  })
})

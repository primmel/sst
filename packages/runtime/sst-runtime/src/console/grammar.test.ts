import { describe, it, expect } from 'vitest'
import { parseCommand, PRIVILEGED_KINDS } from './grammar.js'

describe('console grammar (spec §7)', () => {
  it('show targets parse; unknown shows stay unknown', () => {
    expect(parseCommand('show indication')).toEqual({ kind: 'show', target: 'indication' })
    expect(parseCommand('show ground-truth')).toEqual({ kind: 'show', target: 'ground-truth' })
    expect(parseCommand('show flux')).toEqual({ kind: 'unknown', line: 'show flux' })
  })
  it('actuation commands parse with numbers and units', () => {
    expect(parseCommand('place load 40')).toEqual({ kind: 'placeLoad', massKg: 40 })
    expect(parseCommand('place load 12.5 kg')).toEqual({ kind: 'placeLoad', massKg: 12.5 })
    expect(parseCommand('remove load')).toEqual({ kind: 'removeLoad' })
    expect(parseCommand('set temperature 60')).toEqual({ kind: 'setEnvironment', field: 'temperatureDegC', value: 60 })
    expect(parseCommand('set temperature -10 °C')).toEqual({ kind: 'setEnvironment', field: 'temperatureDegC', value: -10 })
    expect(parseCommand('set humidity 100')).toEqual({ kind: 'setEnvironment', field: 'humidityPercentRh', value: 100 })
    expect(parseCommand('set pressure 98')).toEqual({ kind: 'setEnvironment', field: 'pressureKPa', value: 98 })
  })
  it('durations parse across units', () => {
    expect(parseCommand('advance 5m')).toEqual({ kind: 'advance', seconds: 300 })
    expect(parseCommand('advance 90s')).toEqual({ kind: 'advance', seconds: 90 })
    expect(parseCommand('advance 2h')).toEqual({ kind: 'advance', seconds: 7200 })
    expect(parseCommand('advance 1d')).toEqual({ kind: 'advance', seconds: 86400 })
    expect(parseCommand('advance 5 minutes')).toEqual({ kind: 'unknown', line: 'advance 5 minutes' })
  })
  it('profiles, scenarios, fidelity, clock, watch, lifecycle', () => {
    expect(parseCommand('play profile damp-heat-cyclic-db')).toEqual({ kind: 'playProfile', id: 'damp-heat-cyclic-db' })
    expect(parseCommand('scenario creep-cell')).toEqual({ kind: 'scenario', name: 'creep-cell' })
    expect(parseCommand('set fidelity offset 0.25 lag 30')).toEqual({ kind: 'setFidelity', servedOffsetKg: 0.25, servedLagS: 30 })
    expect(parseCommand('set thermal-hysteresis 0.0002 tau 1800')).toEqual({ kind: 'setThermalHysteresis', perDegC: 0.0002, tauS: 1800 })
    expect(parseCommand('set thermal-hysteresis 0.0001')).toEqual({ kind: 'setThermalHysteresis', perDegC: 0.0001 })
    expect(parseCommand('fidelity reset')).toEqual({ kind: 'fidelityReset' })
    expect(parseCommand('clock mode wall')).toEqual({ kind: 'setClockMode', mode: 'wall' })
    expect(parseCommand('watch indication')).toEqual({ kind: 'watch', target: 'indication' })
    expect(parseCommand('enable')).toEqual({ kind: 'enable' })
    expect(parseCommand('disable')).toEqual({ kind: 'disable' })
    expect(parseCommand('reset')).toEqual({ kind: 'reset' })
    expect(parseCommand('exit')).toEqual({ kind: 'exit' })
    expect(parseCommand('?')).toEqual({ kind: 'help' })
  })
  it('actuation commands are privileged; show/enable are not', () => {
    for (const line of ['place load 40', 'remove load', 'set temperature 60', 'play profile damp-heat-cyclic-db', 'advance 5m', 'scenario creep-cell', 'set fidelity offset 1', 'fidelity reset', 'reset', 'clock mode wall']) {
      const action = parseCommand(line)
      expect(PRIVILEGED_KINDS.has(action.kind), line).toBe(true)
    }
    expect(PRIVILEGED_KINDS.has('show')).toBe(false)
    expect(PRIVILEGED_KINDS.has('enable')).toBe(false)
  })
  it('case-insensitive, whitespace-tolerant', () => {
    expect(parseCommand('  SHOW   Indication  ')).toEqual({ kind: 'show', target: 'indication' })
    expect(parseCommand('Place   Load 40')).toEqual({ kind: 'placeLoad', massKg: 40 })
  })
})

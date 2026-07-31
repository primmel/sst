import { describe, it, expect } from 'vitest'
import { generateGrammar, grammarHelp } from '../src/console/generic-grammar.js'

describe('TODO 22 — kind-generic console grammar', () => {
  it('generates commands from the R 60 world-kind.yaml shape', () => {
    const cmds = generateGrammar({
      mutations: {
        placeLoad:            { sdl: 'placeLoad(massKg: Float!)', handler: 'applyMass' },
        removeLoad:           { sdl: 'removeLoad: WorldState!', handler: 'removeMass' },
        setFidelity:          { sdl: 'setFidelity(servedOffsetKg: Float, servedLagS: Float)', handler: 'setTwinFidelity' },
        fidelityReset:        { sdl: 'fidelityReset: WorldState!', handler: 'resetTwinFidelity' },
        setThermalHysteresis: { sdl: 'setThermalHysteresis(perDegC: Float!, tauS: Float)', handler: 'setThermalHysteresis' },
      },
    })
    expect(cmds.length).toBe(5)
    expect(cmds[0]!.mutation).toBe('placeLoad')
    expect(cmds[0]!.template).toContain('place load')
    expect(cmds[0]!.args[0]!.name).toBe('massKg')
    expect(cmds[0]!.args[0]!.required).toBe(true)
  })

  it('generates commands for the R 91 radar kind', () => {
    const cmds = generateGrammar({
      mutations: {
        setTarget:   { sdl: 'setTarget(speedKmh: Float!, rangeM: Float, angleDeg: Float)', handler: 'setTarget' },
        clearTarget: { sdl: 'clearTarget: WorldState!', handler: 'clearTarget' },
        setRain:     { sdl: 'setRain(rateMmH: Float!)', handler: 'setRain' },
      },
    })
    expect(cmds[0]!.template).toContain('set target')
    expect(cmds[0]!.args.length).toBe(3)
    expect(cmds[1]!.args.length).toBe(0)  // clearTarget has no args
  })

  it('produces readable help text', () => {
    const cmds = generateGrammar({
      mutations: {
        placeLoad:  { sdl: 'placeLoad(massKg: Float!)', handler: 'applyMass' },
        removeLoad: { sdl: 'removeLoad: WorldState!', handler: 'removeMass' },
      },
    })
    const help = grammarHelp(cmds)
    expect(help).toContain('place load')
    expect(help).toContain('remove load')
  })
})

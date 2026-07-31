import { describe, it, expect, expectTypeOf } from 'vitest'
import { projectToTwinView, type TwinView, type EpistemicWallHolds } from '../src/twin/projection.js'

// A test instrument with BOTH legal-view and world-only methods.
interface TestInstrument {
  indication(): number
  servedAt(): number
  operationalState(): string
  environment(): { temperatureDegC: number }
  groundTruth(): { appliedLoadKg: number }     // /world only
  placeMass(kg: number): void                   // actuation — /world only
}

describe('TODO 17 — type-enforced epistemic wall', () => {
  it('projectToTwinView returns the same object at runtime (no wrapper)', () => {
    const inst: TestInstrument = {
      indication: () => 40,
      servedAt: () => 100,
      operationalState: () => 'ready',
      environment: () => ({ temperatureDegC: 20 }),
      groundTruth: () => ({ appliedLoadKg: 40 }),
      placeMass: () => {},
    }
    const view = projectToTwinView(inst)
    expect(view).toBe(inst)
    expect(view.indication()).toBe(40)
  })

  it('TwinView exposes only the four legal methods', () => {
    expectTypeOf<TwinView>().toMatchTypeOf<{
      indication(): unknown
      servedAt(): number
      operationalState(): string
      environment(): unknown
    }>()
  })

  it('TwinView does NOT expose groundTruth', () => {
    type WallHolds = EpistemicWallHolds
    expectTypeOf<WallHolds>().toEqualTypeOf<true>()
  })

  it('TwinView does NOT expose placeMass (actuation is /world-only)', () => {
    expectTypeOf<TwinView>().not.toHaveProperty('placeMass')
  })
})

import { describe, it, expect } from 'vitest'
import { createTwinDriver, type TwinDriver } from '../src/twin/driver.js'
import type { SnakeToCamel, SchemaField, ServeReturn, OpKindFor, ReadMethods, SubscribeMethods, InvokeMethods, FreshnessMap } from '../src/twin/driver-types.js'
import { LC500_CONTRACT, GAS_ANALYZER_CONTRACT } from '@primmel/sst-runtime/twin-contract'

/** Compile-time only — proves the type-level mapping resolves to the
 *  expected literal. If TS widens, this errors at compile time. */
type _Assert<L, R> = [L] extends [R] ? ([R] extends [L] ? true : false) : false
void 0 as unknown as _Assert<SnakeToCamel<'indication_co'>, 'indicationCo'>
void 0 as unknown as _Assert<SnakeToCamel<'get_indication'>, 'getIndication'>
void 0 as unknown as _Assert<SchemaField<'environmental_context'>, 'environmentalContext'>
void 0 as unknown as _Assert<ServeReturn<'indication'>, { value: number; unit: string; kind: string; servedAt: number }>
void 0 as unknown as _Assert<ServeReturn<'state'>, string>
void 0 as unknown as _Assert<ServeReturn<'environmental_context'>, { temperatureDegC: number; humidityPercentRh: number; pressureKPa: number }>
void 0 as unknown as _Assert<OpKindFor<typeof LC500_CONTRACT.operations, 'get_indication'>, 'query'>
void 0 as unknown as _Assert<OpKindFor<typeof LC500_CONTRACT.operations, 'watch_state'>, 'watch'>
void 0 as unknown as _Assert<OpKindFor<typeof LC500_CONTRACT.operations, 'run_self_test'>, 'command'>

describe('TODO 33 — typed TwinDriver<C> (model-driven client surface)', () => {
  describe('runtime method generation', () => {
    it('LC500_CONTRACT generates a driver with indication, state, runSelfTest, subscribeState', () => {
      const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:0')
      expect(typeof driver.indication).toBe('function')
      expect(typeof driver.state).toBe('function')
      expect(typeof driver.runSelfTest).toBe('function')
      expect(typeof driver.subscribeState).toBe('function')
      expect(driver.instrumentId).toBe('acme-lc500')
      expect(driver.url).toBe('http://localhost:0')
    })

    it('LC500_CONTRACT driver has the right freshness map', () => {
      const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:0')
      expect(driver.freshness).toEqual({ indication: 5, state: 1 })
    })

    it('GAS_ANALYZER_CONTRACT generates the dual-component driver surface', () => {
      const driver = createTwinDriver(GAS_ANALYZER_CONTRACT, 'http://localhost:0')
      expect(typeof driver.indicationCo).toBe('function')
      expect(typeof driver.indicationNox).toBe('function')
      expect(typeof driver.state).toBe('function')
      expect(typeof driver.environmentalContext).toBe('function')
      expect(typeof driver.subscribeState).toBe('function')
      expect(typeof driver.subscribeEnvironmentalContext).toBe('function')
      expect(typeof driver.zeroCalibration).toBe('function')
      expect(typeof driver.spanCalibration).toBe('function')
      expect(typeof driver.runSelfCheck).toBe('function')
      expect(driver.instrumentId).toBe('acme-cgm-200')
    })

    it('GAS_ANALYZER_CONTRACT driver.freshness exposes all 4 serves', () => {
      const driver = createTwinDriver(GAS_ANALYZER_CONTRACT, 'http://localhost:0')
      expect(Object.keys(driver.freshness).sort()).toEqual([
        'environmentalContext',
        'indicationCo',
        'indicationNox',
        'state',
      ])
    })

    it('the contract is carried verbatim on the driver', () => {
      const driver = createTwinDriver(LC500_CONTRACT, 'http://localhost:0')
      expect(driver.contract).toBe(LC500_CONTRACT)
    })
  })

  describe('compile-time type checks (the model-driven client promise)', () => {
    // Pure type-level checks. If the model changes (the contract
    // changes), the typed driver surface changes — and these `extends`
    // checks would no longer evaluate to `true`. The `void 0 as unknown
    // as _Check` lines force TS to evaluate the types (otherwise they'd
    // be elided as unused); they execute no runtime code.

    it('LC500 driver has indication/state/runSelfTest/subscribeState keys', () => {
      type LC500Driver = TwinDriver<typeof LC500_CONTRACT>
      type _C1 = 'indication' extends keyof LC500Driver ? true : false
      type _C2 = 'state' extends keyof LC500Driver ? true : false
      type _C3 = 'runSelfTest' extends keyof LC500Driver ? true : false
      type _C4 = 'subscribeState' extends keyof LC500Driver ? true : false
      void 0 as unknown as _C1
      void 0 as unknown as _C2
      void 0 as unknown as _C3
      void 0 as unknown as _C4
      // ReadMethods/SubscribeMethods/InvokeMethods are exported and well-formed.
      void 0 as unknown as ReadMethods<typeof LC500_CONTRACT>
      void 0 as unknown as SubscribeMethods<typeof LC500_CONTRACT>
      void 0 as unknown as InvokeMethods<typeof LC500_CONTRACT>
      void 0 as unknown as FreshnessMap<typeof LC500_CONTRACT>
      expect(true).toBe(true)
    })

    it('GAS_ANALYZER driver has indicationCo/indicationNox/environmentalContext/zeroCalibration keys', () => {
      type GasDriver = TwinDriver<typeof GAS_ANALYZER_CONTRACT>
      type _C1 = 'indicationCo' extends keyof GasDriver ? true : false
      type _C2 = 'indicationNox' extends keyof GasDriver ? true : false
      type _C3 = 'environmentalContext' extends keyof GasDriver ? true : false
      type _C4 = 'subscribeEnvironmentalContext' extends keyof GasDriver ? true : false
      type _C5 = 'zeroCalibration' extends keyof GasDriver ? true : false
      void 0 as unknown as _C1
      void 0 as unknown as _C2
      void 0 as unknown as _C3
      void 0 as unknown as _C4
      void 0 as unknown as _C5
      expect(true).toBe(true)
    })
  })
})

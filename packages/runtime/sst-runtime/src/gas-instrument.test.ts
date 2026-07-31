import { describe, it, expect } from 'vitest'
import { VirtualClock } from './time.js'
import { SimulatedGasAnalyzer, GAS_ANALYZER_GOOD } from './gas-instrument.js'
import { getGasScenario } from './gas-scenario.js'

const WARM = GAS_ANALYZER_GOOD.parameters.warmUpTauS * 5 // 3600 s — the declared warm-up

function make(seed = 42) {
  const clock = new VirtualClock()
  const sim = new SimulatedGasAnalyzer(GAS_ANALYZER_GOOD, clock, seed)
  return { clock, sim }
}
/** boot warm, apply gas, let the response filter settle */
function booted() {
  const { clock, sim } = make()
  clock.advance(WARM)
  return { clock, sim }
}

describe('SimulatedGasAnalyzer (reference CGM, good-analyzer)', () => {
  it('powers on warming, becomes ready after the declared warm-up (5τ = 1 h — R 144-1, 4.7)', () => {
    const { clock, sim } = make()
    expect(sim.operationalState()).toBe('warming')
    clock.advance(WARM - 1)
    expect(sim.operationalState()).toBe('warming')
    clock.advance(1)
    expect(sim.operationalState()).toBe('ready')
  })

  it('indicates the applied concentration per component at reference conditions, in ppm', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    sim.setGasConcentration('nox', 400)
    clock.advance(300) // 10 × filterTauS — settled
    const co = sim.indication('co')
    expect(co.unit).toBe('ppm')
    expect(co.kind).toBe('concentration')
    expect(co.value).toBeCloseTo(800, 0)
    // the NOx channel reads a hair low: only the NO2 share (5 %) passes the converter at η = 96 %
    expect(sim.indication('nox').value).toBeCloseTo(400 * (0.95 + 0.96 * 0.05), 0)
  })

  it('the warm-up envelope decays (CGMs warm up long) — an offset at power-on, gone after 5τ', () => {
    const { clock, sim } = make()
    sim.setGasConcentration('co', 800)
    const early = sim.indication('co').value
    expect(early).toBeGreaterThan(805) // + warmUpOffsetPpm decaying from 10 ppm
    clock.advance(WARM)
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(800, 0)
  })

  it('drift accrues over virtual days (the R 144-1, 4.8 classes: 24 h and 7-day)', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    const day0 = sim.indication('co').value
    clock.advance(86400)
    const day1 = sim.indication('co').value
    clock.advance(6 * 86400)
    const day7 = sim.indication('co').value
    // good-analyzer rates: 0.15 ppm/day zero + 0.1 %/day span (differences of
    // quantized readings land on the 0.1 ppm grid — asserted as tight ranges)
    expect(day1 - day0).toBeGreaterThan(0.8)
    expect(day1 - day0).toBeLessThan(1.1)
    expect(day7 - day0).toBeGreaterThan(6.4)
    expect(day7 - day0).toBeLessThan(6.9)
    // within MPE at 800 ppm (max(2, 5 %) = 40 ppm) at both horizons
    expect(day7 - day0).toBeLessThan(40)
  })

  it('interferents act per channel: additive band-overlap on CO (ndir), quench on NOx (cld)', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 100)
    sim.setGasConcentration('nox', 400)
    clock.advance(300)
    const coDry = sim.indication('co').value
    const noxDry = sim.indication('nox').value
    sim.setInterferents({ co2PercentVol: 20, h2oPercentVol: 20 })
    clock.advance(300)
    // CO: +0.1 ppm/%CO2 × 20 + 0.08 ppm/%H2O × 20 = +3.6 ppm (a difference
    // of quantized readings — tight range around the physics value)
    expect(sim.indication('co').value - coDry).toBeGreaterThan(3.4)
    expect(sim.indication('co').value - coDry).toBeLessThan(3.8)
    // NOx: Stern–Volmer quench 1/(1 + 3e-4·20 + 6e-4·20) ≈ −1.77 %
    const q = 1 / (1 + 3.0e-4 * 20 + 6.0e-4 * 20)
    expect(sim.indication('nox').value / noxDry).toBeCloseTo(q, 2)
  })

  it('pressure and temperature corrections keep the reading inside the residual across the rated range', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    const atRef = sim.indication('co').value
    sim.setEnvironment({ pressureKPa: 106 })
    clock.advance(300)
    const atHighP = sim.indication('co').value
    expect(atHighP).toBeGreaterThan(atRef) // 2 % of the density effect uncorrected, sign positive
    expect(atHighP - atRef).toBeLessThan(2)
    sim.setEnvironment({ pressureKPa: 101.325, temperatureDegC: 40 })
    clock.advance(300)
    const atHighT = sim.indication('co').value
    expect(atHighT).toBeLessThan(atRef + 1) // density ↓ residual + small tc coefficients
    expect(Math.abs(atHighT - atRef)).toBeLessThan(3)
  })

  it('sample-flow deviation moves the indication, bounded (R 144-2, 1.21 territory)', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    const atRef = sim.indication('co').value
    sim.setSampleFlow(1.5)
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(atRef * 1.001, 0)
    sim.setSampleFlow(100) // far outside any rating: clamped at the 5 % bound
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(atRef * 1.05, 0)
  })

  it('ground truth exposes reality (the bench, the raw signals, the drift) — never the indication', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    sim.setInterferents({ co2PercentVol: 15 })
    const gt = sim.groundTruth()
    expect(gt.bench.coPpm).toBe(800)
    expect(gt.bench.co2PercentVol).toBe(15)
    expect(gt.channels.co.rawSignal).toBeGreaterThan(0)
    expect(gt.channels.nox.rawSignal).toBeGreaterThan(0)
    expect(gt.clockS).toBe(clock.now())
    expect(gt.faultLatched).toBe(false)
  })

  it('reset returns to zero gas and re-warms', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    sim.reset()
    expect(sim.operationalState()).toBe('warming')
    expect(sim.groundTruth().bench.coPpm).toBe(0)
  })
})

describe('SimulatedGasAnalyzer — faults realize THROUGH the physics', () => {
  it('contaminated optics: the CO zero climbs by the added absorbance; the NOx span drops 10 %', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('nox', 400)
    clock.advance(300)
    const noxClean = sim.indication('nox').value
    sim.setOpticsContamination(0.1)
    clock.advance(300)
    // CO at zero gas: +0.005 AU ÷ (2e-4 AU/ppm · density) ≈ +27 ppm of false reading
    const coZero = sim.indication('co').value
    expect(coZero).toBeGreaterThan(20)
    expect(coZero).toBeLessThan(35)
    expect(sim.indication('nox').value).toBeCloseTo(noxClean * 0.9, 0)
    // reality shows the contamination; the twin view never carries it
    expect(sim.groundTruth().channels.co.contamination).toBe(0.1)
  })

  it('source aging drifts the CO zero between calibrations (reference-beam residual)', () => {
    const { clock, sim } = booted()
    const day0 = sim.indication('co').value
    sim.setSourceAgingRate(0.02) // 2 %/day intensity loss, 95 % compensated
    clock.advance(86400)
    const day1 = sim.indication('co').value
    // +0.001 AU/day residual ≈ +5.4 ppm/day (plus the small baseline drift)
    expect(day1 - day0).toBeGreaterThan(4)
    expect(day1 - day0).toBeLessThan(7)
    expect(sim.groundTruth().channels.co.agingDriftAU).toBeCloseTo(0.001, 6)
  })

  it('a sample-line leak dilutes the measurands toward ambient air', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    sim.setSampleLineLeak(0.25)
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(600, 0)
    expect(sim.groundTruth().bench.sampleLineLeakFraction).toBe(0.25)
  })

  it('the fault latch freezes the served indications and drives the state (inoperative until resolved)', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    const before = sim.indication('co').value
    sim.injectFault()
    expect(sim.operationalState()).toBe('fault')
    clock.advance(600) // physics keeps running; the served indication must NOT move
    expect(sim.indication('co').value).toBe(before)
    sim.clearFault()
    expect(sim.operationalState()).toBe('ready')
    expect(sim.faultLatched).toBe(false)
  })
})

describe('SimulatedGasAnalyzer — calibration is honest physics (the R 144-1, 4.8 adjustment means)', () => {
  it('zero calibration absorbs the contamination offset — the physics state is untouched', () => {
    const { clock, sim } = booted()
    sim.setOpticsContamination(0.1)
    clock.advance(300)
    expect(sim.indication('co').value).toBeGreaterThan(20)
    sim.zeroCalibration() // zero gas in the cell
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(0, 1)
    expect(sim.groundTruth().channels.co.contamination).toBe(0.1) // still dirty — only the reference moved
  })

  it('a zero calibration with SPAN gas in the cell poisons the zero (the teaching property)', () => {
    const { clock, sim } = booted()
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    sim.zeroCalibration() // the operator's mistake: 800 ppm present
    expect(sim.indication('co').value).toBeCloseTo(0, 0) // reads zero AT the span gas
    sim.setGasConcentration('co', 0)
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(-800, -1) // and −800 at true zero gas
  })

  it('span calibration against true span gas cures the span-shifted scenario', () => {
    const clock = new VirtualClock()
    const sim = new SimulatedGasAnalyzer(getGasScenario('span-shifted'), clock, 42)
    clock.advance(WARM)
    sim.setGasConcentration('co', 800)
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(800 / 1.06, 0)
    sim.spanCalibration() // the configured span value (800) matches the cylinder
    clock.advance(300)
    expect(sim.indication('co').value).toBeCloseTo(800, 0)
  })
})

// how-it-works.ts — the teaching pane (spec §9): the live signal
// chain with per-stage readouts and the constitutive laws (§4.5),
// all fed by /world ground truth.
import type { GroundTruth } from './api.js'

const LAWS: Array<[string, string]> = [
  ['Elastic response', 'ε = F / E·A_eff (compliance constant — datasheet rated deflection)'],
  ['Hysteresis', 'loading and unloading branches differ (branch memory)'],
  ['Creep', 'ε(t) = ε₀·(1 + c·(1 − e^(−t/τ))) — exponential approach, recovery on unload'],
  ['Temperature', 'zero and span shift linearly: T_C0·ΔT, T_Cspan·ΔT (R 60-1 bounds)'],
  ['Barometric', 'dead-load offset per kPa (R 60-1, 5.6.2)'],
  ['Bridge', 'mV/V = sensitivity × strain (Wheatstone, gauge factor constant)'],
  ['ADC + firmware', 'quantization to d, IIR filter, linearization, compensation residual'],
  ['Drift', 'slow multiplicative span drift (span-stability, days)'],
]

export function renderHow(root: HTMLElement, gt: GroundTruth, coefficients: Record<string, number | string>): void {
  const rows = [
    ['Applied load (ground truth)', `${gt.appliedLoadKg.toFixed(2)} kg`],
    ['Elastic strain (stage 1)', gt.strainMm.toExponential(3)],
    ['Span drift accrued', `${(gt.spanDriftFraction * 100).toFixed(4)} %`],
    ['Environment', `${gt.environment.temperatureDegC.toFixed(1)} °C · ${gt.environment.humidityPercentRh.toFixed(0)} %Rh · ${gt.environment.pressureKPa.toFixed(1)} kPa`],
    ['Virtual clock', `${gt.clockS.toFixed(0)} s`],
  ]
  const coeffs = Object.entries(coefficients)
    .map(([k, v]) => `<tr><td>${k}</td><td>${typeof v === 'number' ? v : v}</td></tr>`).join('')
  const laws = LAWS.map(([k, v]) => `<tr><td>${k}</td><td class="law">${v}</td></tr>`).join('')
  root.innerHTML = `
    <p>The indication you see on <b>/twin</b> is computed from this physical state
    (visible only on <b>/world</b>) through the stages below. A certification
    engine can only see the twin side — comparing the two is what testing IS.</p>
    <table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <h3>Current coefficients (the bench knobs)</h3>
    <table>${coeffs}</table>
    <h3>The constitutive laws (why no 3D model — design §4.5)</h3>
    <table>${laws}</table>`
}

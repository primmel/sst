export type Unit = 'kg'|'degC'|'percentRh'|'kPa'|'s'|'mVperV'|'V'|'count'|'kg_per_mm'|'ppm'|'percentVol'|'L_per_min'|'1'|'km/h'|'m'|'deg'|'Hz'|'dB'
export type QuantityKind = 'mass'|'temperature'|'humidity'|'pressure'|'time'|'ratio'|'voltage'|'count'|'stiffness'|'concentration'|'flow'|'dimensionless'|'speed'|'length'|'angle'|'frequency'|'level'
export interface Qty<K extends QuantityKind = QuantityKind> { value: number; unit: Unit; kind: K }

export const UNITS: Record<Unit, QuantityKind> = {
  kg: 'mass', degC: 'temperature', percentRh: 'humidity', kPa: 'pressure',
  s: 'time', mVperV: 'ratio', V: 'voltage', count: 'count',
  kg_per_mm: 'stiffness', ppm: 'concentration', percentVol: 'concentration',
  L_per_min: 'flow', '1': 'dimensionless',
  'km/h': 'speed', m: 'length', deg: 'angle', Hz: 'frequency', dB: 'level',
}

export function qty(value: number, unit: Unit): Qty {
  return { value, unit, kind: UNITS[unit] }
}
function same(a: Qty, b: Qty): void {
  if (a.unit !== b.unit || a.kind !== b.kind) throw new Error(`kind mismatch: ${a.unit}/${a.kind} vs ${b.unit}/${b.kind}`)
}
export function add(a: Qty, b: Qty): Qty { same(a, b); return qty(a.value + b.value, a.unit) }
export function subtract(a: Qty, b: Qty): Qty { same(a, b); return qty(a.value - b.value, a.unit) }
export function mul(a: Qty, scalar: number): Qty { return qty(a.value * scalar, a.unit) }
export function abs(a: Qty): Qty { return qty(Math.abs(a.value), a.unit) }

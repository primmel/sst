// environment/conditions.ts — the OIML D 11 condition vocabulary
// (spec §5: "mainly encoding" — canonical classes + severity encodings
// as data, with their method-standard citations).
import type { Environment } from '../instrument.js'

export interface SeverityLevel {
  id: string
  description: string
  values: Partial<Environment>
}

export interface ConditionClass {
  id: string
  standard: string
  severities: SeverityLevel[]
}

export const D11_CONDITIONS: Record<string, ConditionClass> = {
  'dry-heat': {
    id: 'dry-heat', standard: 'IEC 60068-2-2 (D 11, 10.2)',
    severities: [
      { id: 'BB1', description: 'dry heat +40 °C', values: { temperatureDegC: 40 } },
      { id: 'BB2', description: 'dry heat +55 °C', values: { temperatureDegC: 55 } },
      { id: 'BB3', description: 'dry heat +70 °C', values: { temperatureDegC: 70 } },
    ],
  },
  'cold': {
    id: 'cold', standard: 'IEC 60068-2-1 (D 11, 10.3)',
    severities: [
      { id: 'AA1', description: 'cold −10 °C', values: { temperatureDegC: -10 } },
      { id: 'AA2', description: 'cold −25 °C', values: { temperatureDegC: -25 } },
      { id: 'AA3', description: 'cold −40 °C', values: { temperatureDegC: -40 } },
    ],
  },
  'damp-heat-cyclic': {
    id: 'damp-heat-cyclic', standard: 'IEC 60068-2-30 Db (D 11, 10.4)',
    severities: [
      { id: 'DB1', description: 'upper +40 °C, ≥95 %Rh', values: { temperatureDegC: 40, humidityPercentRh: 95 } },
      { id: 'DB2', description: 'upper +55 °C, ≥95 %Rh', values: { temperatureDegC: 55, humidityPercentRh: 95 } },
    ],
  },
  'damp-heat-steady': {
    id: 'damp-heat-steady', standard: 'IEC 60068-2-78 Cab (D 11, 10.5)',
    severities: [
      { id: 'CAB1', description: '+40 °C, 93 %Rh steady', values: { temperatureDegC: 40, humidityPercentRh: 93 } },
    ],
  },
  'barometric': {
    id: 'barometric', standard: 'IEC 60068-2-13 (D 11, 10.6)',
    severities: [
      { id: 'M1', description: 'low pressure 86 kPa', values: { pressureKPa: 86 } },
      { id: 'M2', description: 'high pressure 106 kPa', values: { pressureKPa: 106 } },
    ],
  },
}

/** Electrical-environment disturbance events (D 11 EMC classes) —
 *  severity-encoded, never transient-modelled (spec §5/§14). */
export interface EnvironmentEvent {
  kind: 'voltage-dip' | 'voltage-variation' | 'burst' | 'surge' | 'esd' | 'rf-field'
  standard: string
  severity: string
  atS: number
  durationS: number
}

export const D11_EVENT_STANDARDS: Record<EnvironmentEvent['kind'], string> = {
  'voltage-dip': 'IEC 61000-4-11',
  'voltage-variation': 'IEC 61000-4-14',
  'burst': 'IEC 61000-4-4',
  'surge': 'IEC 61000-4-5',
  'esd': 'IEC 61000-4-2',
  'rf-field': 'IEC 61000-4-3/-6',
}

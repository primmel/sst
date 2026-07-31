// families/construction.ts — data profiles (spec §4.2), not code.

export interface ConstructionProfile {
  id: string
  /** mm deflection per kg of applied load. */
  complianceKgPerMm: number
  /** loading/unloading branch gap as a fraction of full-scale strain. */
  hysteresisClass: number
  /** asymptotic creep as a fraction of elastic strain. */
  creepCoefficient: number
  /** creep exponential approach constant, seconds. */
  creepTauS: number
  /** first resonance (informational in v1). */
  resonantHz: number
  /** off-center loading sensitivity (informational in v1). */
  offCenterSensitivity: number
}

export const COMPRESSION: ConstructionProfile = {
  id: 'compression',
  complianceKgPerMm: 2.0e-6,   // rated deflection ~1 mm at 500 kg
  hysteresisClass: 0.0005,
  // Class-honest creep (found by the smart repo's behavioral creep probe,
  // TODO.v3/02): the class C creep allowance is p_lc × MPE(D_max) =
  // 0.7 × 1.5 v_min over the 30-min dwell (R 60-1, 5.5.1) — 0.021 kg at
  // v_min 0.02 kg. The previous 0.0003 asymptote (0.15 kg at 500 kg ≈
  // 7.5 v_min) was NOT inside the R 60 class-C limit the blurb claims;
  // 3e-5 lands the asymptote at 0.015 kg at 500 kg = 0.75 v_min — inside
  // the allowance with honest margin (the creep-cell scenario's own
  // 0.004 coefficient stays the deliberate fail case).
  creepCoefficient: 0.00003,
  creepTauS: 300,
  resonantHz: 180,
  offCenterSensitivity: 0.0002,
}
export const CONSTRUCTION_PROFILES: Record<string, ConstructionProfile> = { compression: COMPRESSION }

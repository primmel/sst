// dial.ts — the paired analogue-passive indicator pane (spec §14, smart
// TODO.v2/09): an SVG dial — needle + graduated scale, numbered major
// ticks — fed by the SAME ground truth that feeds the bench scene (the
// /world poll in main.ts). A passive indicator has no twin interface:
// the dial is a RENDERING of reality, never a served value — the
// reading enters evidence through a human observer, never through a
// channel. The dial spec is declared once in @primmel/sst-runtime
// (LC500_PAIRED_DIAL) and consumed by both the model and this renderer.
import { pointerPositionKg, readingUncertaintyKg, type DialSpec } from '@primmel/sst-runtime/physics/stages/dial'

// Gauge geometry: a 270° sweep opening at the bottom (the classic
// indicator layout) — zero rests at 135° (lower-left), full scale at
// 45° (lower-right). SVG y-down: positive angles run clockwise.
const START_DEG = 135
const SWEEP_DEG = 270
const CX = 110, CY = 115, R = 85

/** The needle's rest angle for a pointer position (kg). */
export function needleAngleDeg(spec: DialSpec, pointerKg: number): number {
  return START_DEG + (pointerKg / spec.capacityKg) * SWEEP_DEG
}

function polar(r: number, deg: number): [string, string] {
  const a = (deg * Math.PI) / 180
  return [(CX + r * Math.cos(a)).toFixed(2), (CY + r * Math.sin(a)).toFixed(2)]
}

/** The dial's full SVG markup (scale + needle at zero) — pure, so the
 *  pane's rendering is testable without a DOM. */
export function dialSvg(spec: DialSpec): string {
  const parts: string[] = [
    `<svg viewBox="0 0 220 195" role="img" aria-label="paired analogue dial" xmlns="http://www.w3.org/2000/svg">`,
    `<circle cx="${CX}" cy="${CY}" r="${R + 6}" fill="#fbfaf8" stroke="#e2e0da" stroke-width="1.5"/>`,
  ]
  const minors = Math.round(spec.capacityKg / spec.graduationKg)
  for (let i = 0; i <= minors; i++) {
    const deg = START_DEG + (i / minors) * SWEEP_DEG
    const major = i % 10 === 0
    const [x1, y1] = polar(major ? R - 12 : R - 7, deg)
    const [x2, y2] = polar(R - 1, deg)
    parts.push(`<line class="tick ${major ? 'major' : 'minor'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#444" stroke-width="${major ? 1.6 : 0.7}"/>`)
    if (major) {
      const [tx, ty] = polar(R - 24, deg)
      parts.push(`<text class="dial-num" x="${tx}" y="${ty}" font-size="10" text-anchor="middle" dominant-baseline="middle" fill="#1c1c1e">${i * spec.graduationKg}</text>`)
    }
  }
  // The needle rests at the zero angle; render() rotates it about the hub.
  const [nx, ny] = polar(R - 18, START_DEG)
  parts.push(
    `<g class="dial-needle" transform="rotate(0 ${CX} ${CY})">`,
    `<line x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}" stroke="#b33" stroke-width="2.5" stroke-linecap="round"/>`,
    `</g>`,
    `<circle cx="${CX}" cy="${CY}" r="4" fill="#26252b"/>`,
    `<text class="dial-caption" x="${CX}" y="${CY + 34}" font-size="8.5" text-anchor="middle" fill="#555">graduation ${spec.graduationKg} ${spec.unit} — read to ±${readingUncertaintyKg(spec)} ${spec.unit}</text>`,
    `</svg>`,
  )
  return parts.join('')
}

export interface DialPane { render(truthKg: number): void }

/** Mount the dial under the given element; render() swings the needle
 *  to the ground-truth load, quantized to the pointer's resolution. */
export function mountDial(root: HTMLElement, spec: DialSpec): DialPane {
  root.innerHTML = dialSvg(spec)
  const needle = root.querySelector('.dial-needle')!
  return {
    render(truthKg: number) {
      const angle = needleAngleDeg(spec, pointerPositionKg(spec, truthKg)) - START_DEG
      needle.setAttribute('transform', `rotate(${angle} ${CX} ${CY})`)
    },
  }
}

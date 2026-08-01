// main.ts — the bench SPA entry: four panes wired to the sim.
// /world feeds the bench + dials + the paired dial + how-it-works;
// /twin feeds the indication display. Two channels, polled separately
// on purpose.
import { startPolling, type GroundTruth, type Indication } from './api.js'
import { mountTerminal } from './terminal.js'
import { mountBench, renderDials } from './bench.js'
import { mountDial } from './dial.js'
import { renderHow } from './how-it-works.js'
import { LC500_PAIRED_DIAL } from '@primmel/sst-runtime/instrument'

const baseUrl = location.origin
const COEFFS: Record<string, number | string> = {
  compliance: '2.0e-6 mm/kg',
  creepCoefficient: '3.0e-4 (good-cell)',
  creepTauS: '300 s',
  tcZero: '1.0e-4 /°C',
  tcSpan: '2.0e-4 /°C',
  scaleInterval: '0.05 kg',
  filterTau: '1.0 s',
  warmUpTau: '60 s',
}

const bench = mountBench(document.getElementById('bench-canvas') as HTMLCanvasElement)
mountTerminal(document.getElementById('pane-terminal')!, baseUrl)
const howRoot = document.getElementById('how')!
// The paired passive indicator renders the same ground truth as the
// bench scene — a human reads it; it is never served.
const dial = mountDial(document.getElementById('dial-scale')!, LC500_PAIRED_DIAL)

let lastGt: GroundTruth | null = null
startPolling(baseUrl, 500, gt => {
  lastGt = gt
  bench?.render(gt)
  dial.render(gt.appliedLoadKg)
  renderHow(howRoot, gt, COEFFS)
}, (ind: { indication: Indication; state: string }) => {
  if (lastGt) renderDials(lastGt, ind.indication)
})

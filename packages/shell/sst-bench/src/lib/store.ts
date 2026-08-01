// store.ts — a tiny reactive store (Vue's reactive()) shared across the
// bench's islands. The Console registers its runCommand() and step
// runners here on mount; the QuickActions, the TopBar tour button, and
// the TourRunner all call into the same machinery. Polling data
// (groundTruth, indication) lands here too, so the BenchScene HUD and the
// DialInset react to a single source of truth.
import { reactive } from 'vue'
import type { GroundTruth, Indication } from '../api.js'
import { LC500_TOUR } from '@primmel/sst-runtime/console/tour'

/** One tour step (mirrors @primmel/sst-runtime/console/tour's TourStep, kept here so
 *  the bench can drive the tour step-by-step without touching core). */
export interface TourStep {
  narrate: string
  command: string
  pauseMs?: number
}

/** The default tour — load-cell-shaped, since the bench ships only the
 *  LC-500 family today. Other console-shipping families will pass their
 *  own steps when they land. */
const DEFAULT_TOUR: TourStep[] = LC500_TOUR as unknown as TourStep[]

export interface BenchState {
  baseUrl: string
  scenario: string
  scenarioDescription: string
  drawerOpen: boolean
  privileged: boolean
  tourSeen: boolean
  polling: boolean
  groundTruth: GroundTruth | null
  indication: { indication: Indication; state: string } | null
  // Registered by <Console> on mount. Until then, callers fall back to
  // echoing a hint to open the console.
  runCommand: null | ((cmd: string, opts?: { echo?: boolean; elevate?: boolean }) => Promise<void>)
  // Registered by <Console> on mount — executes one tour step (narration +
  // command + result) into the console log, with privileged elevation.
  runTourStep: null | ((step: TourStep) => Promise<void>)

  // Tour runner state — step-by-step. The user clicks "Next" to advance.
  tour: {
    active: boolean
    step: number       // 0-based index of the current step
    total: number
    narration: string  // the current step's narration, shown in the runner UI
  }
}

export const bench = reactive<BenchState>({
  baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  scenario: 'good-cell',
  scenarioDescription: 'All coefficients inside R 60 limits — passes the test program.',
  drawerOpen: false,
  privileged: false,
  tourSeen: false,
  polling: false,
  groundTruth: null,
  indication: null,
  runCommand: null,
  runTourStep: null,
  tour: { active: false, step: 0, total: 0, narration: '' },
})

/** Helper for buttons that need to run a console command. Falls back
 *  gracefully if the console hasn't mounted yet (it always has, by the
 *  time a button is clickable, but defensive never hurts). */
export async function runCommand(cmd: string, opts?: { echo?: boolean; elevate?: boolean }): Promise<void> {
  if (bench.runCommand) await bench.runCommand(cmd, opts)
}

/** Open the How-it-works drawer (idempotent). */
export function openDrawer(): void { bench.drawerOpen = true }
export function closeDrawer(): void { bench.drawerOpen = false }
export function toggleDrawer(): void { bench.drawerOpen = !bench.drawerOpen }

/** Start the step-by-step tour. The actual step execution is delegated
 *  to <Console>'s runTourStep (registered on mount); this function only
 *  flips the tour active and runs step 0. Subsequent steps advance via
 *  nextTourStep() — driven by the user clicking "Next". */
export async function startTour(steps: TourStep[] = DEFAULT_TOUR): Promise<void> {
  if (bench.tour.active || steps.length === 0) return
  bench.tourSeen = true
  bench.tour.active = true
  bench.tour.step = 0
  bench.tour.total = steps.length
  bench.tour.narration = steps[0]!.narrate
  if (bench.runTourStep) await bench.runTourStep(steps[0]!)
}

/** Advance the tour by one step. Ends the tour if past the last step. */
export async function nextTourStep(steps: TourStep[] = DEFAULT_TOUR): Promise<void> {
  if (!bench.tour.active) return
  const next = bench.tour.step + 1
  if (next >= steps.length) { endTour(); return }
  bench.tour.step = next
  bench.tour.narration = steps[next]!.narrate
  if (bench.runTourStep) await bench.runTourStep(steps[next]!)
}

/** End the tour (Skip button, or natural completion). */
export function endTour(): void {
  bench.tour.active = false
  bench.tour.step = 0
  bench.tour.narration = ''
}


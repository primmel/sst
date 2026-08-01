// quick-actions.ts — the button toolbar above the console (spec §9). The
// console grammar is the canonical surface; these buttons are a friction-free
// alternative for users who haven't learned it yet. Clicking one feeds the
// mapped command through the SAME console machinery — the log echoes it, so
// the grammar is taught by observation.
//
// Group coloring mirrors the channel palette: world-blue for actuation on
// /world, twin-amber for reads off /twin, warn-yellow for scenarios, danger-red
// for the reset.

export interface QuickAction {
  label: string
  command: string
  hint: string
  variant: 'world' | 'twin' | 'warn' | 'danger' | 'default'
}

export interface QuickActionGroup {
  title: string
  actions: QuickAction[]
}

const GROUPS: QuickActionGroup[] = [
  {
    title: 'Load',
    actions: [
      { label: 'Place 40 kg',  command: 'place load 40',   hint: 'A typical R 60 test load — about 8 % of capacity.',           variant: 'world' },
      { label: 'Place 200 kg', command: 'place load 200',  hint: 'About 40 % of capacity — mid-range repeatability point.',     variant: 'world' },
      { label: 'Remove load',  command: 'remove load',     hint: 'Clear the pan. Watch the creep recovery and hysteresis.',     variant: 'world' },
    ],
  },
  {
    title: 'Environment (OIML D 11)',
    actions: [
      { label: '20 °C',  command: 'set temperature 20',  hint: 'Reference temperature — the rated operating point.',          variant: 'world' },
      { label: '60 °C',  command: 'set temperature 60',  hint: 'Hot extreme — drives the temperature coefficients.',          variant: 'world' },
      { label: '−10 °C', command: 'set temperature -10', hint: 'Cold extreme — lower end of the rated range.',                variant: 'world' },
      { label: 'Damp heat', command: 'play profile damp-heat-cyclic-db', hint: 'The IEC 60068-2-30 cyclic humidity profile.', variant: 'world' },
    ],
  },
  {
    title: 'Time',
    actions: [
      { label: '+5 min',  command: 'advance 5m',  hint: 'A short virtual dwell — the filter and creep settle.',         variant: 'world' },
      { label: '+30 min', command: 'advance 30m', hint: 'The R 60 creep-test window — watch drift accumulate.',       variant: 'world' },
    ],
  },
  {
    title: 'Scenarios — swap the instrument',
    actions: [
      { label: 'good-cell',   command: 'scenario good-cell',   hint: 'All coefficients inside R 60 limits — passes the test program.', variant: 'warn' },
      { label: 'creep-cell',  command: 'scenario creep-cell',  hint: 'Excessive creep coefficient — fails the 30-min creep test.',     variant: 'warn' },
      { label: 'lying-twin',  command: 'scenario lying-twin',  hint: 'Honest physics, dishonest twin — a certification must catch it.', variant: 'warn' },
    ],
  },
  {
    title: 'Console',
    actions: [
      { label: 'Show indication',  command: 'show indication',   hint: 'Read /twin — what the instrument legally says right now.',  variant: 'twin' },
      { label: 'Show ground truth', command: 'show ground-truth', hint: 'Read /world — reality, what the operator set.',            variant: 'world' },
      { label: 'Help',   command: 'help',   hint: 'List every console command.',                                  variant: 'default' },
      { label: 'Tour',   command: 'tour',   hint: 'The narrated first run — the two channels in action.',         variant: 'default' },
      { label: 'Reset',  command: 'reset',  hint: 'Power-cycle the simulated instrument.',                          variant: 'danger' },
    ],
  },
]

export function renderQuickActions(
  root: HTMLElement,
  runCommand: (cmd: string, opts?: { echo?: boolean; elevate?: boolean }) => void,
): void {
  root.innerHTML = GROUPS.map(g => `
    <div class="qa-group">
      <div class="qa-label">${g.title}</div>
      <div class="qa-row">
        ${g.actions.map((a, i) => `
          <button class="qa-btn ${a.variant}" data-cmd="${escapeAttr(a.command)}" title="${escapeAttr(a.hint)}">
            ${escapeHtml(a.label)}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('')

  for (const btn of root.querySelectorAll<HTMLButtonElement>('.qa-btn')) {
    const cmd = btn.dataset.cmd!
    // the privileged commands (place/remove/set/advance/scenario/reset/play)
    // are auto-elevated: a GUI button is implicit consent, and the
    // teaching moment ("you can also type `enable` first") is in the
    // console grammar, not in button friction.
    const elevate = cmd !== 'help' && cmd !== 'tour' && !cmd.startsWith('show ')
    btn.addEventListener('click', () => runCommand(cmd, { echo: true, elevate }))
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

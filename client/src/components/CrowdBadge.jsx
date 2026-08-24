import { CROWD_LEVELS } from '../lib/constants.js';
import { cx } from '../lib/format.js';

/**
 * Crowd level is a *status*, so it always ships as icon + label + text — colour
 * never carries the meaning on its own (colourblind users, print, forced-colors).
 */
const TONE = {
  low: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900',
  moderate: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900',
  high: 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900',
  closed: 'bg-ink-100 text-ink-600 ring-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:ring-ink-700',
};

export function CrowdBadge({ crowd, showWait = true, size = 'sm', className }) {
  if (!crowd) return null;

  const level = crowd.isOpen === false ? 'closed' : crowd.level;
  const meta = CROWD_LEVELS[level] ?? CROWD_LEVELS.closed;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-semibold ring-1',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        TONE[level],
        className
      )}
      title={crowd.disclaimer}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      <span>{level === 'closed' ? 'Closed' : meta.label}</span>
      {showWait && crowd.isOpen && (
        <>
          <span className="opacity-40" aria-hidden="true">·</span>
          <span className="font-medium">{crowd.waitMinutes?.label}</span>
        </>
      )}
    </span>
  );
}

/** The expanded version used on the restaurant page. */
export function CrowdPanel({ crowd }) {
  if (!crowd) return null;

  const confidenceCopy = {
    high: 'High confidence — plenty of recent signal',
    medium: 'Moderate confidence — some recent signal',
    low: 'Low confidence — very little data for this venue yet',
  }[crowd.confidence];

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CrowdBadge crowd={crowd} size="md" showWait={false} />
        <div className="text-right">
          <div className="text-xs muted">Estimated wait</div>
          <div className="text-lg font-bold text-ink-900 dark:text-ink-50">
            {crowd.isOpen ? crowd.waitMinutes?.label : 'Closed right now'}
          </div>
        </div>
      </div>

      <dl className="mt-4 space-y-2">
        {crowd.signals?.map((signal) => (
          <div key={signal.key} className="flex items-start justify-between gap-4 text-sm">
            <dt className="text-ink-700 dark:text-ink-300">
              {signal.label}
              <span className="block text-xs muted">{signal.detail}</span>
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums text-ink-900 dark:text-ink-100">{signal.value}</dd>
          </div>
        ))}
      </dl>

      {crowd.contextNotes?.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-xs muted dark:border-ink-800">
          {crowd.contextNotes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-ink-100 pt-3 text-xs muted dark:border-ink-800">
        <strong className="font-semibold text-ink-600 dark:text-ink-300">{confidenceCopy}.</strong>{' '}
        Estimated from this app’s own check-ins, visitor reports and historical patterns — not live
        occupancy data from any map provider.
        {crowd.source === 'ml' && ' Refined by the trained crowd model.'}
      </p>
    </div>
  );
}

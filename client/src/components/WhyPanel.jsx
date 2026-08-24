import { useState } from 'react';
import { cx } from '../lib/format.js';

/**
 * "Why this recommendation?"
 *
 * Reads straight off the engine's factor breakdown — the same numbers that
 * produced the ranking. The bars encode magnitude (0–100% match on that
 * factor) in a single sequential hue; the ✓ / ~ marker and the written reason
 * carry the meaning independently of colour.
 */
export function WhyPanel({ item, defaultOpen = false, compact = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const factors = (item.factors ?? []).filter((f) => f.weight > 0);
  const matched = factors.filter((f) => f.passed);

  if (!factors.length && !item.explanation) return null;

  return (
    <div className={cx('rounded-xl border border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-950/40', compact ? 'p-3' : 'p-4')}>
      {item.explanation && (
        <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          {item.explanation}
          {item.explanationSource === 'template' && (
            <span className="ml-1 text-xs muted" title="Written from the engine's own factor breakdown rather than by the language model.">
              (auto-generated)
            </span>
          )}
        </p>
      )}

      {matched.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {matched.map((factor) => (
            <li
              key={factor.key}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900"
            >
              <span aria-hidden="true">✓</span> {factor.label}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-3 text-xs font-bold text-brand-700 hover:underline dark:text-brand-400"
        aria-expanded={open}
      >
        {open ? 'Hide the score breakdown' : 'Why this recommendation?'}
      </button>

      {open && (
        <div className="mt-3 animate-fade-up">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              How each factor contributed to the {item.matchPercent}% match score
            </caption>
            <thead>
              <tr className="muted">
                <th scope="col" className="pb-1 font-semibold">Factor</th>
                <th scope="col" className="pb-1 text-right font-semibold">Weight</th>
                <th scope="col" className="pb-1 pl-3 font-semibold">Match on this factor</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((factor) => {
                const percent = Math.round(factor.score * 100);
                return (
                  <tr key={factor.key} className="align-top">
                    <th scope="row" className="py-1.5 pr-2 font-medium text-ink-800 dark:text-ink-200">
                      <span aria-hidden="true" className={factor.passed ? 'text-emerald-600' : 'text-ink-400'}>
                        {factor.passed ? '✓' : '~'}
                      </span>{' '}
                      {factor.label}
                      <span className="block font-normal muted">{factor.detail}</span>
                    </th>
                    <td className="py-1.5 text-right tabular-nums muted">{Math.round(factor.weight * 100)}%</td>
                    <td className="w-32 py-1.5 pl-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${percent}%`,
                              // Sequential ramp: darker = stronger match.
                              background: percent >= 70 ? 'var(--viz-seq-450)' : percent >= 40 ? 'var(--viz-seq-400)' : 'var(--viz-seq-250)',
                              transition: 'width 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right tabular-nums font-semibold text-ink-700 dark:text-ink-300">
                          {percent}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {item.adjustments?.length > 0 && (
            <div className="mt-3 border-t border-ink-200 pt-2 dark:border-ink-800">
              <p className="mb-1 text-xs font-semibold text-ink-700 dark:text-ink-300">Extra adjustments</p>
              <ul className="space-y-0.5 text-xs muted">
                {item.adjustments.map((adjustment, index) => (
                  <li key={`${adjustment.key}-${index}`}>
                    <span className={cx('font-bold', adjustment.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {adjustment.delta > 0 ? '+' : ''}{Math.round(adjustment.delta * 100)}
                    </span>{' '}
                    {adjustment.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

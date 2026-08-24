import { useState } from 'react';
import { CROWD_LEVELS, DAY_NAMES } from '../lib/constants.js';
import { cx, hourLabel } from '../lib/format.js';

/**
 * How busy this place usually is, hour by hour.
 *
 * Form: magnitude over an ordered categorical axis (hours) -> vertical bars.
 * Colour: the fixed status palette (low / moderate / high), always paired with
 * the legend, the hovered readout and the table view, so colour never carries
 * the meaning alone. Bars keep a 2px surface gap and 4px rounded data-ends.
 */
const STATUS_COLOR = {
  low: 'var(--viz-status-good)',
  moderate: 'var(--viz-status-warning)',
  high: 'var(--viz-status-critical)',
  closed: 'var(--viz-status-idle)',
};

const LEGEND = [
  { level: 'low', label: 'Low' },
  { level: 'moderate', label: 'Moderate' },
  { level: 'high', label: 'High' },
];

export function CrowdChart({ outlook = [], dayOfWeek, onDayChange, currentHour = new Date().getHours() }) {
  const [hovered, setHovered] = useState(null);
  const [asTable, setAsTable] = useState(false);

  const openHours = outlook.filter((h) => h.level !== 'closed');
  if (!openHours.length) {
    return <p className="text-sm muted">No pattern available for this day yet.</p>;
  }

  // Show only the hours the venue is actually open, plus one either side.
  const firstHour = Math.max(0, openHours[0].hour - 1);
  const lastHour = Math.min(23, openHours[openHours.length - 1].hour + 1);
  const visible = outlook.filter((h) => h.hour >= firstHour && h.hour <= lastHour);

  const peak = visible.reduce((best, h) => (h.score > (best?.score ?? -1) ? h : best), null);
  const readout = hovered ?? visible.find((h) => h.hour === currentHour) ?? peak;

  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">How busy it usually gets</h3>
          <p className="text-xs muted">
            {readout
              ? `${DAY_NAMES[dayOfWeek]} ${hourLabel(readout.hour)} — ${CROWD_LEVELS[readout.level]?.label ?? 'Closed'}${
                readout.samples ? ` · ${readout.samples} past observations` : ' · modelled estimate'
              }`
              : 'Hover a bar for details'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="crowd-day">Day of week</label>
          <select
            id="crowd-day"
            className="field w-auto py-1.5 text-xs"
            value={dayOfWeek}
            onChange={(event) => onDayChange(Number(event.target.value))}
          >
            {DAY_NAMES.map((name, index) => (
              <option key={name} value={index}>{name}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setAsTable((value) => !value)}
            aria-pressed={asTable}
          >
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
      </figcaption>

      {asTable ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-ink-100 dark:border-ink-800">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Estimated crowd level by hour on {DAY_NAMES[dayOfWeek]}</caption>
            <thead className="sticky top-0 bg-ink-50 dark:bg-ink-900">
              <tr className="muted">
                <th scope="col" className="px-3 py-2 font-semibold">Hour</th>
                <th scope="col" className="px-3 py-2 font-semibold">Level</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Score</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Observations</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((hour) => (
                <tr key={hour.hour} className="border-t border-ink-100 dark:border-ink-800">
                  <th scope="row" className="px-3 py-1.5 font-medium tabular-nums text-ink-800 dark:text-ink-200">
                    {hourLabel(hour.hour)}
                  </th>
                  <td className="px-3 py-1.5">
                    <span aria-hidden="true">{CROWD_LEVELS[hour.level]?.emoji ?? '⚪'}</span>{' '}
                    {hour.level === 'closed' ? 'Closed' : CROWD_LEVELS[hour.level]?.label}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums muted">{hour.score}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums muted">{hour.samples || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="flex h-40 items-end gap-[2px] border-b"
          style={{ borderColor: 'var(--viz-baseline)' }}
          onMouseLeave={() => setHovered(null)}
        >
          {visible.map((hour) => {
            const isNow = hour.hour === currentHour;
            const height = hour.level === 'closed' ? 3 : Math.max(6, hour.score);
            return (
              <button
                key={hour.hour}
                type="button"
                className="group relative flex h-full flex-1 cursor-pointer items-end"
                onMouseEnter={() => setHovered(hour)}
                onFocus={() => setHovered(hour)}
                onBlur={() => setHovered(null)}
                aria-label={`${hourLabel(hour.hour)}: ${hour.level === 'closed' ? 'closed' : CROWD_LEVELS[hour.level]?.label}, score ${hour.score}`}
              >
                <span
                  className="w-full animate-grow-bar origin-bottom rounded-t"
                  style={{
                    height: `${height}%`,
                    backgroundColor: STATUS_COLOR[hour.level] ?? STATUS_COLOR.closed,
                    opacity: hovered && hovered.hour !== hour.hour ? 0.45 : 1,
                    outline: isNow ? '2px solid var(--viz-text)' : 'none',
                    outlineOffset: '1px',
                    transition: 'opacity 150ms',
                  }}
                />
                {isNow && (
                  <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[9px] font-bold text-white dark:bg-ink-100 dark:text-ink-900">
                    now
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!asTable && (
        <div className="mt-1.5 flex justify-between text-[10px] tabular-nums" style={{ color: 'var(--viz-muted)' }}>
          <span>{hourLabel(visible[0].hour)}</span>
          {peak && <span className="font-semibold">Peak {hourLabel(peak.hour)}</span>}
          <span>{hourLabel(visible[visible.length - 1].hour)}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs muted">
        {LEGEND.map((entry) => (
          <span key={entry.level} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLOR[entry.level] }} aria-hidden="true" />
            <span aria-hidden="true">{CROWD_LEVELS[entry.level].emoji}</span>
            {entry.label}
          </span>
        ))}
      </div>

      <p className={cx('mt-2 text-xs muted')}>
        Our own estimate, built from check-ins, visitor crowd reports and historical patterns for this
        venue. Not live occupancy data from any map provider.
      </p>
    </figure>
  );
}

import { cx } from '../lib/format.js';

/**
 * The match percentage as a single hero figure inside a ring.
 * One value, no axis, no legend — a stat tile, not a chart.
 */
export function MatchRing({ value = 0, size = 64, label = 'match', className }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="4"
          className="stroke-ink-200 dark:stroke-ink-700"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="4" strokeLinecap="round"
          stroke="var(--viz-seq-450)"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-extrabold leading-none text-ink-900 dark:text-ink-50">{Math.round(clamped)}%</span>
        <span className="text-[9px] font-medium uppercase tracking-wide muted">{label}</span>
      </div>
    </div>
  );
}

/** Inline pill for tight spaces (search results, list rows). */
export function MatchPill({ value }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-ink-100 dark:text-ink-900">
      {Math.round(value)}% match
    </span>
  );
}

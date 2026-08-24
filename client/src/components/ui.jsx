import { useEffect } from 'react';
import { cx } from '../lib/format.js';

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Loading…', className = '' }) {
  return (
    <div className={cx('flex items-center justify-center gap-3 py-12 text-ink-500 dark:text-ink-400', className)} role="status">
      <Spinner />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card p-4">
      <div className="skeleton mb-3 h-28 w-full" />
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={cx('skeleton mb-2 h-3', index === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 6, lines = 3 }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={lines} />
      ))}
    </div>
  );
}

export function EmptyState({ emoji = '🍽️', title, description, action }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="text-5xl" aria-hidden="true">{emoji}</div>
      <h3 className="text-base font-bold text-ink-900 dark:text-ink-50">{title}</h3>
      {description && <p className="max-w-md text-sm muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'That did not work' }) {
  const isOffline = error?.status === 0;
  return (
    <div className="card flex flex-col items-center gap-3 border-rose-200 px-6 py-12 text-center dark:border-rose-900/60">
      <div className="text-4xl" aria-hidden="true">{isOffline ? '🔌' : '⚠️'}</div>
      <h3 className="text-base font-bold text-ink-900 dark:text-ink-50">{isOffline ? 'Cannot reach the server' : title}</h3>
      <p className="max-w-md text-sm muted">{error?.message ?? 'An unexpected error occurred.'}</p>
      {error?.details && (
        <ul className="text-xs text-rose-600 dark:text-rose-400">
          {Object.entries(error.details).map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary mt-1" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Chip({ active, children, className, ...props }) {
  return (
    <button type="button" className={cx(active ? 'chip-active' : 'chip-idle', className)} aria-pressed={active} {...props}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', className }) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
    brand: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Stars({ value = 0, size = 'text-xs' }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5 font-semibold text-amber-500', size)} aria-label={`${value} out of 5`}>
      <span aria-hidden="true">★</span>
      <span className="text-ink-700 dark:text-ink-200">{Number(value).toFixed(1)}</span>
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative z-10 max-h-[88vh] w-full animate-scale-in overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl dark:bg-ink-900',
          size
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 -mt-1 px-2 py-1 text-xl leading-none" aria-label="Close">
            ×
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition',
          checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700'
        )}
      >
        <span className={cx('block h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
      <span>
        <span className="block text-sm font-semibold text-ink-800 dark:text-ink-200">{label}</span>
        {description && <span className="block text-xs muted">{description}</span>}
      </span>
    </label>
  );
}

/** Horizontally scrollable chip rail — the mobile filter pattern used app-wide. */
export function ChipRail({ children, className }) {
  return (
    <div className={cx('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1', className)}>{children}</div>
  );
}

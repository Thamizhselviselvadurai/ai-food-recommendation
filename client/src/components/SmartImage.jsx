import { useState } from 'react';
import { cx } from '../lib/format.js';

/**
 * Photo with a guaranteed fallback.
 *
 * Real dish photographs come from Wikimedia Commons (resolved server-side at
 * seed time); restaurant photos come from Google Places when a key is
 * configured. Either can 404, be blocked, or simply not exist — so this always
 * degrades to the emoji-on-gradient tile rather than a broken image icon.
 */
export function SmartImage({
  src,
  alt,
  emoji = '🍽️',
  gradient = 'from-brand-400 to-rose-500',
  className,
  imgClassName,
  rounded = 'rounded-2xl',
  attribution,
  eager = false,
}) {
  const [status, setStatus] = useState(src ? 'loading' : 'fallback');

  const showFallback = status === 'fallback';

  return (
    <div
      className={cx('relative overflow-hidden bg-gradient-to-br', gradient, rounded, className)}
      title={attribution ?? undefined}
    >
      {!showFallback && (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('fallback')}
          className={cx(
            'h-full w-full object-cover transition-opacity duration-300',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      )}

      {/* Emoji tile: the fallback, and the placeholder while the photo loads. */}
      {status !== 'loaded' && (
        <div
          className={cx(
            'absolute inset-0 flex items-center justify-center',
            status === 'loading' && 'animate-pulse'
          )}
          aria-hidden="true"
        >
          <span className="text-[2.5em] leading-none drop-shadow">{emoji}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Rating that tells the truth when there is no rating.
 * OpenStreetMap publishes none, so we say so rather than showing a made-up ★.
 */
export function RatingLabel({ rating, count, source, className }) {
  if (typeof rating !== 'number') {
    return (
      <span className={cx('text-xs muted', className)} title={`Rating not published by this data source (${source ?? 'unknown'})`}>
        No rating data
      </span>
    );
  }
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-semibold text-amber-500', className)}>
      <span aria-hidden="true">★</span>
      <span className="text-ink-700 dark:text-ink-200">{Number(rating).toFixed(1)}</span>
      {count > 0 && <span className="font-normal muted">({count})</span>}
    </span>
  );
}

const PRICE_LABEL = { low: '₹ Low', medium: '₹₹ Medium', high: '₹₹₹ High' };

/** Price band, marked as an estimate when it was inferred from the venue type. */
export function PriceLabel({ priceCategory, source, className }) {
  if (!priceCategory) {
    return <span className={cx('text-xs muted', className)}>Price not listed</span>;
  }

  const estimated = source === 'estimated_from_venue_type';
  return (
    <span
      className={cx('text-xs muted', className)}
      title={
        estimated
          ? 'Estimated from the venue type — OpenStreetMap does not publish price levels. Add a Google Places key for real price data.'
          : undefined
      }
    >
      {PRICE_LABEL[priceCategory]}
      {estimated && <span className="ml-0.5 opacity-70">(est.)</span>}
    </span>
  );
}

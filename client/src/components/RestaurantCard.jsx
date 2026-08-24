import { Link } from 'react-router-dom';
import { Badge } from './ui.jsx';
import { CrowdBadge } from './CrowdBadge.jsx';
import { PriceLabel, RatingLabel } from './SmartImage.jsx';
import { CUISINES, findLabel } from '../lib/constants.js';
import { cx, minutes, rupees } from '../lib/format.js';

/** Builds a maps directions link. Opens the user's default map app; nothing is sent to us. */
export const navigationUrl = (place) =>
  place?.coordinates
    ? `https://www.openstreetmap.org/directions?to=${place.coordinates.lat}%2C${place.coordinates.lng}`
    : null;

export function RestaurantCard({ place, onCheckIn, onReport, compact = false }) {
  const cuisines = (place.cuisines ?? []).slice(0, 3).map((id) => findLabel(CUISINES, id, id));

  return (
    <article className="card card-hover animate-fade-up overflow-hidden">
      <div className={cx('flex items-center gap-3 bg-gradient-to-r p-4 text-white', place.coverGradient ?? 'from-brand-500 to-rose-600')}>
        <span className="text-4xl" aria-hidden="true">{place.emoji}</span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold">{place.name}</h3>
          <p className="truncate text-xs text-white/85">{place.tagline}</p>
        </div>
      </div>

      <div className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {place.distanceLabel && <span className="font-semibold text-ink-800 dark:text-ink-200">{place.distanceLabel} away</span>}
          {/* OpenStreetMap publishes no ratings or price levels, so these say so
              rather than rendering an empty star row and a confident "(0)". */}
          <RatingLabel rating={place.rating} count={place.ratingCount} source={place.ratingSource} />
          <span className="muted">·</span>
          <PriceLabel priceCategory={place.priceCategory} source={place.priceSource} />
          {place.isPureVeg && <Badge tone="green">Pure veg</Badge>}
        </div>

        <p className="text-xs muted">{cuisines.join(' · ')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <CrowdBadge crowd={place.crowd} />
          {place.isOpen === false && <Badge tone="neutral">Closed</Badge>}
          {place.closingSoon && <Badge tone="amber">Closing soon</Badge>}
          {/* Never imply a venue is open when its provider published no hours. */}
          {place.hoursKnown === false && <Badge tone="neutral">Hours not listed</Badge>}
        </div>

        {place.crowd?.isOpen && (
          <p className="text-xs muted">
            Estimated wait <strong className="font-semibold text-ink-700 dark:text-ink-300">{place.crowd.waitMinutes.label}</strong>
            {place.timing?.travelMinutes != null && <> · ~{minutes(place.timing.travelMinutes)} to get there</>}
            {place.avgCostForOne != null && <> · about {rupees(place.avgCostForOne)} for one</>}
          </p>
        )}

        {!compact && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to={`/restaurant/${place.id}`} className="btn-primary flex-1 sm:flex-none">
              View food
            </Link>
            {navigationUrl(place) && (
              <a
                href={navigationUrl(place)}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-secondary flex-1 sm:flex-none"
              >
                🧭 Navigate
              </a>
            )}
            {onCheckIn && (
              <button type="button" className="btn-ghost" onClick={() => onCheckIn(place)}>
                I&apos;m here
              </button>
            )}
            {onReport && (
              <button type="button" className="btn-ghost" onClick={() => onReport(place)}>
                Report crowd
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

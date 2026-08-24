import { Link } from 'react-router-dom';
import { Badge } from './ui.jsx';
import { PriceLabel, RatingLabel, SmartImage } from './SmartImage.jsx';
import { CrowdBadge } from './CrowdBadge.jsx';
import { MatchRing } from './MatchRing.jsx';
import { WhyPanel } from './WhyPanel.jsx';
import { cx, distance, minutes, rupees, titleCase } from '../lib/format.js';

const DIET_DOT = {
  veg: { color: 'text-emerald-600 border-emerald-600', label: 'Vegetarian' },
  vegan: { color: 'text-lime-600 border-lime-600', label: 'Vegan' },
  egg: { color: 'text-amber-600 border-amber-600', label: 'Contains egg' },
  nonveg: { color: 'text-rose-600 border-rose-600', label: 'Non-vegetarian' },
};

function DietMark({ dietType }) {
  const meta = DIET_DOT[dietType] ?? DIET_DOT.veg;
  return (
    <span
      className={cx('inline-flex h-4 w-4 items-center justify-center rounded-sm border-2', meta.color)}
      title={meta.label}
      aria-label={meta.label}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
    </span>
  );
}

/**
 * The primary recommendation card: dish + where + why + what to do next.
 * Used by the wizard, chat, dashboard and alternatives.
 */
export function RecommendationCard({
  item,
  rank,
  onAddToCart,
  onOrderNow,
  onFindNearby,
  onShowAlternatives,
  onReject,
  showWhy = true,
  highlight = false,
}) {
  const { food, restaurant, crowd } = item;
  if (!food || !restaurant) return null;

  const nutrition = food.nutrition ?? {};

  return (
    <article
      className={cx(
        'card card-hover animate-fade-up overflow-hidden',
        highlight && 'border-brand-400 ring-2 ring-brand-200 dark:border-brand-600 dark:ring-brand-900'
      )}
    >
      {highlight && (
        <div className="bg-gradient-to-r from-brand-600 to-rose-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
          🥇 Best recommendation for you right now
        </div>
      )}

      <div className="flex gap-4 p-4">
        <SmartImage
          src={food.imageUrl}
          alt={food.name}
          emoji={food.emoji}
          gradient={restaurant.coverGradient ?? 'from-brand-400 to-rose-500'}
          attribution={food.imageAttribution}
          className="h-20 w-20 shrink-0 text-base"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {rank && <span className="text-xs font-bold muted">#{rank}</span>}
                <DietMark dietType={food.dietType} />
                <h3 className="truncate text-base font-bold text-ink-900 dark:text-ink-50">{food.name}</h3>
              </div>
              <Link
                to={`/restaurant/${restaurant.id}`}
                className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-brand-700 dark:text-ink-400 dark:hover:text-brand-400"
              >
                <span aria-hidden="true">{restaurant.emoji}</span>
                {restaurant.name}
                {item.distanceLabel && <span className="muted">· {item.distanceLabel}</span>}
              </Link>
            </div>
            <MatchRing value={item.matchPercent} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-lg font-extrabold text-ink-900 dark:text-ink-50">{rupees(food.price)}</span>
            {item.overBudget && <Badge tone="amber">Over budget</Badge>}
            <RatingLabel rating={restaurant.rating} count={restaurant.ratingCount} source={restaurant.ratingSource} />
            <span className="muted">·</span>
            <span className="muted">{titleCase(food.spiceLevel)} spice</span>
            {item.timing?.etaMinutes != null && (
              <>
                <span className="muted">·</span>
                <span className="muted">~{minutes(item.timing.etaMinutes)}</span>
              </>
            )}
          </div>

          {food.description && <p className="mt-1.5 line-clamp-2 text-sm muted">{food.description}</p>}

          {/* Live venues do not publish menus, so an indicative dish says so
              rather than passing itself off as something the kitchen listed. */}
          {food.menuSource === 'indicative' && (
            <p className="mt-1 text-xs italic text-amber-700 dark:text-amber-400" title={food.menuDisclaimer}>
              Typical dish for this kind of place — menu and price are indicative.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CrowdBadge crowd={crowd} />
            {item.closingSoon && <Badge tone="amber">Closing soon</Badge>}
            {/* `isOpen` is null when the venue publishes no hours. That is not
                the same as being shut, and saying "Closed now" for it was wrong. */}
            {item.isOpen === false && <Badge tone="neutral">Closed now</Badge>}
            {item.isOpen == null && <Badge tone="neutral">Hours not listed</Badge>}
            {nutrition.calories != null && (
              <span className="text-xs muted" title={nutrition.disclaimer}>
                ~{Math.round(nutrition.calories)} kcal · {Math.round(nutrition.protein ?? 0)} g protein (est.)
              </span>
            )}
          </div>
        </div>
      </div>

      {showWhy && (
        <div className="px-4 pb-4">
          <WhyPanel item={item} defaultOpen={highlight} compact />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink-100 px-4 py-3 dark:border-ink-800">
        {onAddToCart && (
          <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={() => onAddToCart(item)}>
            Add to cart
          </button>
        )}
        {onOrderNow && (
          <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => onOrderNow(item)}>
            Order now
          </button>
        )}
        {onFindNearby && (
          <button type="button" className="btn-ghost" onClick={() => onFindNearby(item)}>
            📍 Find nearby
          </button>
        )}
        {onShowAlternatives && (
          <button type="button" className="btn-ghost" onClick={() => onShowAlternatives(item)}>
            Show alternatives
          </button>
        )}
        {onReject && (
          <button
            type="button"
            className="btn-ghost ml-auto text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            onClick={() => onReject(item)}
          >
            ✕ Not for me
          </button>
        )}
      </div>
    </article>
  );
}

/** Compact variant for horizontal rails on the dashboard. */
export function RecommendationTile({ item, onClick }) {
  const { food, restaurant } = item;
  if (!food) return null;

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className="card card-hover w-56 shrink-0 p-3 text-left"
    >
      <SmartImage
        src={food.imageUrl}
        alt={food.name}
        emoji={food.emoji}
        gradient={restaurant?.coverGradient ?? 'from-brand-400 to-rose-500'}
        attribution={food.imageAttribution}
        className="mb-2 h-24 w-full text-xl"
        rounded="rounded-xl"
      />
      <div className="flex items-start justify-between gap-2">
        <h4 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{food.name}</h4>
        <span className="shrink-0 text-xs font-bold text-brand-700 dark:text-brand-400">{item.matchPercent}%</span>
      </div>
      <p className="truncate text-xs muted">{restaurant?.name}</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-sm font-extrabold text-ink-900 dark:text-ink-50">{rupees(food.price)}</span>
        {item.distanceKm != null && <span className="text-xs muted">{distance(item.distanceKm)}</span>}
      </div>
    </button>
  );
}

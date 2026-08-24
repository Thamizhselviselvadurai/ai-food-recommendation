import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { CUISINES, DIET_TYPES, PRICE_CATEGORIES, SPICE_LEVELS, findLabel } from '../lib/constants.js';
import { CrowdBadge } from '../components/CrowdBadge.jsx';
import { SmartImage } from '../components/SmartImage.jsx';
import { Chip, ChipRail, EmptyState, ErrorState, SkeletonGrid, Toggle } from '../components/ui.jsx';
import { cx, distance, minutes, rupees } from '../lib/format.js';

const EMPTY_FILTERS = {
  dietType: '',
  cuisine: '',
  spiceLevel: '',
  maxPrice: '',
  priceCategory: '',
  openNow: true,
  sort: 'relevance',
};

const SORTS = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'price_asc', label: 'Cheapest' },
  { id: 'price_desc', label: 'Most expensive' },
  { id: 'rating', label: 'Top rated' },
  { id: 'distance', label: 'Nearest' },
  { id: 'prep_time', label: 'Fastest to make' },
];

export default function Search() {
  const { location } = useLocation();
  const { add } = useCart();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  const debouncedQuery = useDebounced(query, 350);

  const { data, loading, error, run } = useAsync(
    () =>
      api.searchFoods({
        q: debouncedQuery || undefined,
        dietType: filters.dietType || undefined,
        cuisine: filters.cuisine || undefined,
        spiceLevel: filters.spiceLevel || undefined,
        maxPrice: filters.maxPrice || undefined,
        priceCategory: filters.priceCategory || undefined,
        openNow: filters.openNow ? 'true' : undefined,
        sort: filters.sort,
        ...(location ? { lat: location.lat, lng: location.lng, radiusKm: 10 } : {}),
        limit: 40,
      }),
    [debouncedQuery, filters, location?.lat, location?.lng]
  );

  const set = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const foods = data?.foods ?? [];

  // Fall back to the full list only before the first response has landed, and
  // always keep the current selection selectable so it can be cleared.
  const available = data?.facets?.cuisines;
  const cuisineOptions = available
    ? [
      ...available,
      ...(filters.cuisine && !available.some((c) => c.id === filters.cuisine)
        ? [{ id: filters.cuisine, count: 0 }]
        : []),
    ]
    : CUISINES.map((c) => ({ id: c.id, count: null }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">🔎 Search food &amp; restaurants</h1>
        <p className="mt-1 text-sm muted">Plain search across every nearby menu. For ranked picks, use Decide or Ask AI.</p>
      </header>

      <div className="card space-y-3 p-4">
        <label className="sr-only" htmlFor="q">Search dishes</label>
        <input
          id="q"
          className="field text-base"
          placeholder="Search for biryani, dosa, salad, pizza…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <ChipRail>
          {/* Price band filter — applied in the database query, so it narrows the
              whole menu rather than just the page of results already fetched. */}
          {PRICE_CATEGORIES.map((price) => (
            <Chip
              key={price.id}
              active={filters.priceCategory === price.id}
              onClick={() => set({ priceCategory: filters.priceCategory === price.id ? '' : price.id })}
              className="shrink-0 whitespace-nowrap"
              title={price.hint}
            >
              {price.label}
            </Chip>
          ))}
          {DIET_TYPES.map((diet) => (
            <Chip
              key={diet.id}
              active={filters.dietType === diet.id}
              onClick={() => set({ dietType: filters.dietType === diet.id ? '' : diet.id })}
              className="shrink-0 whitespace-nowrap"
            >
              <span aria-hidden="true">{diet.emoji}</span> {diet.label}
            </Chip>
          ))}
          {SPICE_LEVELS.map((spice) => (
            <Chip
              key={spice.id}
              active={filters.spiceLevel === spice.id}
              onClick={() => set({ spiceLevel: filters.spiceLevel === spice.id ? '' : spice.id })}
              className="shrink-0 whitespace-nowrap"
            >
              <span aria-hidden="true">{spice.emoji}</span> {spice.label}
            </Chip>
          ))}
        </ChipRail>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="cuisine">Cuisine</label>
            <select id="cuisine" className="field" value={filters.cuisine} onChange={(event) => set({ cuisine: event.target.value })}>
              <option value="">Any cuisine</option>
              {/* Only cuisines that actually exist on menus in range, with counts.
                  Listing all of them produced dead ends: picking "Chinese" near a
                  town with no Chinese venue could only ever return nothing. */}
              {cuisineOptions.map((cuisine) => (
                <option key={cuisine.id} value={cuisine.id}>
                  {findLabel(CUISINES, cuisine.id, cuisine.id)}{cuisine.count != null ? ` (${cuisine.count})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="maxPrice">Max price</label>
            <input
              id="maxPrice"
              type="number"
              min="20"
              className="field"
              placeholder="₹ any"
              value={filters.maxPrice}
              onChange={(event) => set({ maxPrice: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="sort">Sort by</label>
            <select id="sort" className="field" value={filters.sort} onChange={(event) => set({ sort: event.target.value })}>
              {SORTS.map((sort) => (
                <option key={sort.id} value={sort.id}>{sort.label}</option>
              ))}
            </select>
          </div>
        </div>

        <Toggle checked={filters.openNow} onChange={(value) => set({ openNow: value })} label="Open now only" />
      </div>

      {loading ? (
        <SkeletonGrid count={6} lines={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={run} />
      ) : foods.length ? (
        <>
          <p className="text-sm muted">{foods.length} dishes found</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {foods.map((food) => (
              <article key={food.id} className="card card-hover flex flex-col p-4">
                <div className="flex items-start gap-3">
                  {/* Real dish photograph when one resolved, emoji tile otherwise. */}
                  <SmartImage
                    src={food.imageUrl}
                    alt={food.name}
                    emoji={food.emoji}
                    attribution={food.imageAttribution}
                    className="h-16 w-16 shrink-0 text-base"
                    rounded="rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{food.name}</h3>
                    <Link
                      to={`/restaurant/${food.restaurant.id}`}
                      className="truncate text-xs text-ink-600 hover:text-brand-700 dark:text-ink-400"
                    >
                      {food.restaurant.emoji} {food.restaurant.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-base font-extrabold text-ink-900 dark:text-ink-50">{rupees(food.price)}</span>
                      {food.distanceKm != null && <span className="muted">{distance(food.distanceKm)}</span>}
                      <span className="muted">{minutes(food.prepTimeMinutes)}</span>
                    </div>
                  </div>
                </div>

                {food.description && <p className="mt-2 line-clamp-2 text-xs muted">{food.description}</p>}

                {food.menuSource === 'indicative' && (
                  <p className="mt-1 text-[11px] italic text-amber-700 dark:text-amber-400" title={food.menuDisclaimer}>
                    Typical dish — menu not published by this venue.
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CrowdBadge crowd={food.crowd} showWait={false} />
                  {food.nutrition?.calories != null && (
                    <span className="text-[11px] muted" title={food.nutrition.disclaimer}>
                      ~{Math.round(food.nutrition.calories)} kcal (est.)
                    </span>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={cx('btn-primary flex-1 py-2 text-xs', !food.isOpen && 'opacity-60')}
                    onClick={() => {
                      const { replaced } = add(food, food.restaurant, 1);
                      toast.success(replaced ? `Cart replaced with ${food.name}` : `${food.name} added to cart`);
                    }}
                  >
                    Add to cart
                  </button>
                  <Link to={`/restaurant/${food.restaurant.id}`} className="btn-secondary py-2 text-xs">Menu</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <NoMatches
          filters={filters}
          query={query}
          facets={data?.facets}
          onClear={(patch) => set(patch)}
          onClearAll={() => { setQuery(''); setFilters({ ...EMPTY_FILTERS }); }}
        />
      )}
    </div>
  );
}

/**
 * An empty result is nearly always caused by one specific filter, and the user
 * cannot tell which. This names the culprit — using what the API says is
 * actually on the menus in range — and offers to drop just that one.
 */
function NoMatches({ filters, query, facets, onClear, onClearAll }) {
  const available = facets?.cuisines ?? [];
  const cuisineLabel = (id) => findLabel(CUISINES, id, id);

  const cuisineMissing =
    filters.cuisine && !available.some((c) => c.id === filters.cuisine);

  const priceTooLow =
    facets?.priceRange &&
    ((filters.maxPrice && Number(filters.maxPrice) < facets.priceRange.min) ||
      (filters.priceCategory === 'high' && facets.priceRange.max <= 350) ||
      (filters.priceCategory === 'low' && facets.priceRange.min >= 150));

  let title = 'No dishes matched';
  let description = 'Try a different word, drop a filter, or raise the maximum price.';
  let action = null;

  if (facets && facets.totalDishes === 0) {
    title = 'No menus near you yet';
    description =
      'We could not find any venues with menus in this area. Try the Near me page to pull in restaurants around you first.';
  } else if (cuisineMissing) {
    title = `No ${cuisineLabel(filters.cuisine)} food near you`;
    description = available.length
      ? `Nothing within range serves it. What is actually on menus around you: ${available
        .slice(0, 6)
        .map((c) => `${cuisineLabel(c.id)} (${c.count})`)
        .join(', ')}.`
      : 'Nothing within range serves it.';
    action = (
      <button type="button" className="btn-primary mt-2" onClick={() => onClear({ cuisine: '' })}>
        Clear the cuisine filter
      </button>
    );
  } else if (priceTooLow) {
    title = 'Nothing in that price range';
    description = `Dishes near you run from ₹${facets.priceRange.min} to ₹${facets.priceRange.max}.`;
    action = (
      <button type="button" className="btn-primary mt-2" onClick={() => onClear({ maxPrice: '', priceCategory: '' })}>
        Clear the price filter
      </button>
    );
  } else if (query) {
    title = `Nothing matched “${query}”`;
    description = 'No dish on the menus near you has that name. Try a shorter or more general word.';
  }

  return (
    <EmptyState
      emoji="🍳"
      title={title}
      description={description}
      action={
        action ?? (
          <button type="button" className="btn-secondary mt-2" onClick={onClearAll}>
            Reset all filters
          </button>
        )
      }
    />
  );
}

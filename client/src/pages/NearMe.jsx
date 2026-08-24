import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { CUISINES, PRICE_CATEGORIES } from '../lib/constants.js';
import { MapView } from '../components/MapView.jsx';
import { RestaurantCard } from '../components/RestaurantCard.jsx';
import { RecommendationCard } from '../components/RecommendationCard.jsx';
import { CheckInDialog, CrowdReportDialog } from '../components/CrowdDialogs.jsx';
import { Badge, Chip, ChipRail, EmptyState, ErrorState, SectionHeader, SkeletonGrid, Toggle } from '../components/ui.jsx';
import { cx } from '../lib/format.js';

/**
 * Says where the list actually came from. "Near me" is only trustworthy if the
 * user can tell real venues from the bundled sample city, so this never hides
 * the difference.
 */
function DataSourceNote({ sources, count }) {
  if (!sources) return null;

  if (sources.demoData) {
    return (
      <div className="card border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <strong className="font-semibold">Showing sample data.</strong>{' '}
        We could not reach the live map provider just now, so these are the bundled demo restaurants — not places
        near you. Try again in a moment.
      </div>
    );
  }

  if (!count) return null;

  return (
    <p className="flex flex-wrap items-center gap-2 text-xs muted">
      <Badge tone="green">Real venues</Badge>
      <span>{sources.attribution ?? 'Live place data'}</span>
      {!sources.ratingsAvailable && <span>· ratings and price levels are not published by this source</span>}
    </p>
  );
}

const SORTS = [
  { id: 'best', label: 'Best overall' },
  { id: 'distance', label: 'Nearest' },
  { id: 'wait', label: 'Shortest wait' },
  { id: 'crowd', label: 'Least crowded' },
  { id: 'rating', label: 'Top rated' },
  { id: 'price', label: 'Cheapest' },
];

export default function NearMe() {
  const { location, status, error: locationError, request, hasLocation } = useLocation();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const [filters, setFilters] = useState({
    radiusKm: 5,
    sort: 'best',
    priceCategory: '',
    cuisines: [],
    lowCrowdOnly: false,
    openNow: true,
  });
  const [showMap, setShowMap] = useState(true);
  const [checkInTarget, setCheckInTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);

  // Natural-language "smart decision" bar.
  const [smartQuery, setSmartQuery] = useState('');
  const [smart, setSmart] = useState({ loading: false, data: null, error: null });

  const { data, loading, error, run } = useAsync(
    () =>
      api.nearby({
        ...(location ? { lat: location.lat, lng: location.lng } : {}),
        radiusKm: filters.radiusKm,
        sort: filters.sort,
        priceCategory: filters.priceCategory || undefined,
        cuisines: filters.cuisines.length ? filters.cuisines.join(',') : undefined,
        lowCrowdOnly: filters.lowCrowdOnly || undefined,
        openNow: filters.openNow,
        limit: 30,
      }),
    [location?.lat, location?.lng, filters]
  );

  const askSmart = async (event) => {
    event.preventDefault();
    if (!smartQuery.trim()) return;
    setSmart({ loading: true, data: null, error: null });
    try {
      const response = await api.smartDecision({
        query: smartQuery,
        location: location ? { lat: location.lat, lng: location.lng } : null,
        limit: 4,
      });
      setSmart({ loading: false, data: response, error: null });
    } catch (requestError) {
      setSmart({ loading: false, data: null, error: requestError });
    }
  };

  const toggleCuisine = (id) =>
    setFilters((current) => ({
      ...current,
      cuisines: current.cuisines.includes(id) ? current.cuisines.filter((c) => c !== id) : [...current.cuisines, id],
    }));

  const places = data?.places ?? [];
  const center = data?.context?.location;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">📍 Find food near me</h1>
        <p className="mt-1 text-sm muted">
          Nearby places with our own crowd estimate and expected wait — so you can pick somewhere good that
          isn’t packed.
        </p>
      </header>

      {!hasLocation && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/40">
          <div>
            <p className="text-sm font-bold text-brand-900 dark:text-brand-200">Use your location for accurate distances</p>
            <p className="text-xs text-brand-800/80 dark:text-brand-300/80">
              Used only for this search. We never store your exact coordinates — anything we keep is rounded to
              roughly a kilometre.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={request} disabled={status === 'requesting'}>
            {status === 'requesting' ? 'Locating…' : 'Share my location'}
          </button>
        </div>
      )}

      {locationError && <p className="text-xs text-amber-700 dark:text-amber-400">{locationError}</p>}

      {/* Smart decision bar — the "biryani, ₹250, near me, no waiting" flow */}
      <form onSubmit={askSmart} className="card p-4">
        <label className="label" htmlFor="smart">Describe what you want in one line</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="smart"
            className="field flex-1"
            placeholder="I'm hungry, I want biryani, I have ₹250 and I don't want to wait"
            value={smartQuery}
            onChange={(event) => setSmartQuery(event.target.value)}
            maxLength={300}
          />
          <button type="submit" className="btn-primary sm:px-6" disabled={smart.loading}>
            {smart.loading ? 'Deciding…' : '✨ Decide for me'}
          </button>
        </div>
      </form>

      {smart.error && <ErrorState error={smart.error} />}

      {smart.data && (
        <section className="space-y-3">
          <SectionHeader
            title="Smart decision"
            subtitle={
              smart.data.intent
                ? `Understood: ${[
                  smart.data.intent.keywords?.length && smart.data.intent.keywords.join(', '),
                  smart.data.intent.budget && `≤ ₹${smart.data.intent.budget}`,
                  smart.data.intent.avoidWaiting && 'no waiting',
                  smart.data.intent.dietType,
                ].filter(Boolean).join(' · ')}`
                : undefined
            }
            action={
              <button type="button" className="btn-ghost text-sm" onClick={() => setSmart({ loading: false, data: null, error: null })}>
                Clear
              </button>
            }
          />
          {smart.data.best ? (
            <>
              <RecommendationCard
                item={smart.data.best}
                highlight
                onAddToCart={(item) => { add(item.food, item.restaurant, 1); toast.success('Added to cart'); }}
                onOrderNow={(item) => { add(item.food, item.restaurant, 1); navigate('/cart'); }}
              />
              {smart.data.runnersUp?.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {smart.data.runnersUp.map((item, index) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      rank={index + 2}
                      showWhy={false}
                      onAddToCart={(target) => { add(target.food, target.restaurant, 1); toast.success('Added to cart'); }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState emoji="🤷" title="Nothing matched that" description="Try a bigger budget or a longer wait." />
          )}
        </section>
      )}

      {/* Filters */}
      <div className="card space-y-3 p-4">
        <ChipRail>
          {SORTS.map((sort) => (
            <Chip
              key={sort.id}
              active={filters.sort === sort.id}
              onClick={() => setFilters((current) => ({ ...current, sort: sort.id }))}
              className="shrink-0 whitespace-nowrap"
            >
              {sort.label}
            </Chip>
          ))}
        </ChipRail>

        <ChipRail>
          {PRICE_CATEGORIES.map((price) => (
            <Chip
              key={price.id}
              active={filters.priceCategory === price.id}
              onClick={() =>
                setFilters((current) => ({ ...current, priceCategory: current.priceCategory === price.id ? '' : price.id }))
              }
              className="shrink-0 whitespace-nowrap"
            >
              {price.label}
            </Chip>
          ))}
          {CUISINES.slice(0, 8).map((cuisine) => (
            <Chip
              key={cuisine.id}
              active={filters.cuisines.includes(cuisine.id)}
              onClick={() => toggleCuisine(cuisine.id)}
              className="shrink-0 whitespace-nowrap"
            >
              {cuisine.label}
            </Chip>
          ))}
        </ChipRail>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="radius">
              Within <span className="text-brand-600">{filters.radiusKm} km</span>
            </label>
            <input
              id="radius"
              type="range"
              min="1"
              max="15"
              step="1"
              value={filters.radiusKm}
              onChange={(event) => setFilters((current) => ({ ...current, radiusKm: Number(event.target.value) }))}
              className="w-full accent-brand-600"
            />
          </div>
          <Toggle
            checked={filters.lowCrowdOnly}
            onChange={(value) => setFilters((current) => ({ ...current, lowCrowdOnly: value }))}
            label="Only quiet places"
            description="Hide anywhere we estimate as moderately or very busy."
          />
          <Toggle
            checked={filters.openNow}
            onChange={(value) => setFilters((current) => ({ ...current, openNow: value }))}
            label="Open now"
            description="Hide places that are currently closed."
          />
        </div>
      </div>

      {center && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionHeader title="Map" subtitle={`${places.length} places within ${filters.radiusKm} km`} />
            <button type="button" className="btn-ghost text-sm" onClick={() => setShowMap((value) => !value)}>
              {showMap ? 'Hide map' : 'Show map'}
            </button>
          </div>
          {showMap && <MapView places={places} center={center} />}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <p className="text-sm muted">
            {hasLocation
              ? 'Finding real restaurants around you and estimating how busy each one is…'
              : 'Loading places and estimating how busy each one is…'}
          </p>
          <SkeletonGrid count={6} lines={3} />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={run} />
      ) : places.length ? (
        <div className="space-y-3">
          <DataSourceNote sources={data?.dataSources} count={places.length} />
          <div className={cx('grid gap-4 sm:grid-cols-2 lg:grid-cols-3')}>
            {places.map((place) => (
              <RestaurantCard
                key={place.id}
                place={place}
                onCheckIn={setCheckInTarget}
                onReport={setReportTarget}
              />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          emoji="🌙"
          title="Nothing open within that radius"
          description="Widen the distance, or turn off “Open now” to see everything around you."
          action={
            <button
              type="button"
              className="btn-secondary mt-2"
              onClick={() => setFilters((current) => ({ ...current, radiusKm: Math.min(15, current.radiusKm + 5), openNow: false }))}
            >
              Widen search
            </button>
          }
        />
      )}

      <CheckInDialog
        place={checkInTarget}
        open={Boolean(checkInTarget)}
        onClose={() => setCheckInTarget(null)}
        onDone={run}
      />
      <CrowdReportDialog
        place={reportTarget}
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        onDone={run}
      />
    </div>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { CUISINES, DAY_NAMES, findLabel } from '../lib/constants.js';
import { CrowdPanel } from '../components/CrowdBadge.jsx';
import { CrowdChart } from '../components/CrowdChart.jsx';
import { CheckInDialog, CrowdReportDialog } from '../components/CrowdDialogs.jsx';
import { MatchPill } from '../components/MatchRing.jsx';
import { WhyPanel } from '../components/WhyPanel.jsx';
import { navigationUrl } from '../components/RestaurantCard.jsx';
import { Badge, EmptyState, ErrorState, Loading, SectionHeader, Stars } from '../components/ui.jsx';
import { cx, relativeTime, rupees, titleCase } from '../lib/format.js';

const CATEGORY_LABEL = {
  breakfast: 'Breakfast & tiffin',
  main: 'Main course',
  snack: 'Snacks & starters',
  side: 'Sides & soups',
  dessert: 'Desserts',
  beverage: 'Drinks',
};

export default function RestaurantDetail() {
  const { id } = useParams();
  const { location } = useLocation();
  const { add } = useCart();
  const { isAuthenticated } = useAuth();
  const toast = useToast();

  const [day, setDay] = useState(new Date().getDay());
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [favorited, setFavorited] = useState(false);

  const { data, loading, error, run } = useAsync(
    () => api.restaurant(id, location ? { lat: location.lat, lng: location.lng } : {}),
    [id, location?.lat, location?.lng]
  );

  const outlook = useAsync(() => api.crowdOutlook(id, day), [id, day]);

  if (loading) return <Loading label="Loading restaurant…" />;
  if (error) return <ErrorState error={error} onRetry={run} />;
  if (!data) return <EmptyState emoji="🍽️" title="Restaurant not found" />;

  const { restaurant, crowd, menu, menuByCategory, reviews, aiPicks } = data;

  const addItem = (food) => {
    const { replaced } = add(food, restaurant, 1);
    toast.success(replaced ? `Cart replaced with ${food.name}` : `${food.name} added to cart`);
  };

  const toggleFavorite = async () => {
    if (!isAuthenticated) {
      toast.error('Sign in to save favourites.');
      return;
    }
    try {
      const response = await api.toggleFavorite({ targetType: 'restaurant', id: restaurant.id });
      setFavorited(response.favorited);
      toast.success(response.favorited ? 'Saved to favourites' : 'Removed from favourites');
    } catch (requestError) {
      toast.error(requestError.message);
    }
  };

  const todayHours = restaurant.openingHours?.filter((h) => h.dayOfWeek === new Date().getDay() && !h.closed) ?? [];

  return (
    <div className="space-y-6">
      <div className={cx('overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-white shadow-sm', restaurant.coverGradient ?? 'from-brand-500 to-rose-600')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-6xl" aria-hidden="true">{restaurant.emoji}</span>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{restaurant.name}</h1>
              <p className="text-sm text-white/85">{restaurant.tagline}</p>
              <p className="mt-1 text-xs text-white/80">
                {restaurant.address?.line1}, {restaurant.address?.area}, {restaurant.address?.city}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {navigationUrl(restaurant) && (
              <a href={navigationUrl(restaurant)} target="_blank" rel="noreferrer noopener" className="btn bg-white/20 text-white hover:bg-white/30">
                🧭 Navigate
              </a>
            )}
            <button type="button" className="btn bg-white/20 text-white hover:bg-white/30" onClick={toggleFavorite}>
              {favorited ? '★ Saved' : '☆ Save'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1 font-bold">★ {restaurant.rating?.toFixed(1)}</span>
          <span className="text-white/80">({restaurant.ratingCount} ratings)</span>
          {restaurant.distanceKm != null && <span className="text-white/90">📍 {restaurant.distanceKm.toFixed(1)} km away</span>}
          {restaurant.avgCostForOne != null && (
            <span className="text-white/90">{rupees(restaurant.avgCostForOne)} for one</span>
          )}
          {restaurant.isPureVeg && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">Pure veg</span>}
          <span className="text-white/90">
            {/* Unknown hours (null) must not read as "closed" — many real venues
                simply do not publish opening times. */}
            {restaurant.isOpen == null
              ? 'Hours not listed'
              : restaurant.isOpen
                ? `Open${todayHours.length ? ` · ${todayHours[0].open}–${todayHours[0].close}` : ''}`
                : 'Closed right now'}
          </span>
        </div>

        <p className="mt-2 text-xs text-white/75">
          {(restaurant.cuisines ?? []).map((c) => findLabel(CUISINES, c, c)).join(' · ')}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {aiPicks?.length > 0 && (
            <section>
              <SectionHeader title="AI picks from this menu" subtitle="Ranked against your preferences right now." />
              <div className="space-y-3">
                {aiPicks.map((pick) => (
                  <div key={pick.id} className="card p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-3xl" aria-hidden="true">{pick.food.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold">{pick.food.name}</h3>
                          <MatchPill value={pick.matchPercent} />
                        </div>
                        <p className="text-sm font-extrabold text-ink-900 dark:text-ink-50">{rupees(pick.food.price)}</p>
                      </div>
                      <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => addItem(pick.food)}>
                        Add
                      </button>
                    </div>
                    <div className="mt-3">
                      <WhyPanel item={pick} compact />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionHeader title="Menu" subtitle={`${menu.length} items`} />
            <div className="space-y-5">
              {menuByCategory.map((group) => (
                <div key={group.category}>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide muted">
                    {CATEGORY_LABEL[group.category] ?? titleCase(group.category)}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((food) => (
                      <div key={food.id} className="card flex items-start gap-3 p-3">
                        <span className="text-3xl" aria-hidden="true">{food.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{food.name}</h4>
                          <p className="line-clamp-2 text-xs muted">{food.description}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-sm font-extrabold text-ink-900 dark:text-ink-50">{rupees(food.price)}</span>
                            <Badge tone={food.dietType === 'nonveg' ? 'rose' : food.dietType === 'vegan' ? 'green' : 'neutral'}>
                              {titleCase(food.dietType)}
                            </Badge>
                            <span className="muted">{titleCase(food.spiceLevel)}</span>
                            {food.nutrition?.calories != null && (
                              <span className="muted" title={food.nutrition.disclaimer}>~{Math.round(food.nutrition.calories)} kcal (est.)</span>
                            )}
                          </div>
                          {food.allergens?.length > 0 && (
                            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                              Contains: {food.allergens.map(titleCase).join(', ')}
                            </p>
                          )}
                        </div>
                        <button type="button" className="btn-secondary shrink-0 px-3 py-1.5 text-xs" onClick={() => addItem(food)}>
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Reviews" subtitle={`${reviews.length} recent`} />
            {reviews.length ? (
              <div className="space-y-3">
                {reviews.map((review) => (
                  <div key={review.id} className="card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold">{review.authorName}</span>
                      <Stars value={review.rating} />
                    </div>
                    {review.title && <p className="mt-1 text-sm font-semibold">{review.title}</p>}
                    <p className="mt-0.5 text-sm muted">{review.body}</p>
                    <p className="mt-1 text-xs muted">{relativeTime(review.createdAt)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState emoji="💬" title="No reviews yet" description="Be the first to review after your visit." />
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <CrowdPanel crowd={crowd} />

          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setCheckInOpen(true)}>
              I&apos;m here now
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setReportOpen(true)}>
              Report crowd
            </button>
          </div>

          <div className="card p-4">
            {outlook.loading ? (
              <div className="skeleton h-40 w-full" />
            ) : outlook.error ? (
              <p className="text-sm muted">Crowd pattern unavailable.</p>
            ) : (
              <CrowdChart
                outlook={outlook.data?.outlook ?? data.crowdOutlook ?? []}
                dayOfWeek={day}
                onDayChange={setDay}
              />
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-sm font-bold">Opening hours</h3>
            <ul className="space-y-1 text-sm">
              {DAY_NAMES.map((name, index) => {
                const windows = restaurant.openingHours?.filter((h) => h.dayOfWeek === index && !h.closed) ?? [];
                return (
                  <li key={name} className={cx('flex justify-between', index === new Date().getDay() && 'font-bold')}>
                    <span className="muted">{name}</span>
                    <span>{windows.length ? windows.map((w) => `${w.open}–${w.close}`).join(', ') : 'Closed'}</span>
                  </li>
                );
              })}
            </ul>
            {restaurant.phone && (
              <p className="mt-3 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
                📞 <a href={`tel:${restaurant.phone.replace(/\s/g, '')}`} className="font-semibold hover:underline">{restaurant.phone}</a>
              </p>
            )}
            {restaurant.dataSource === 'seed' && (
              <p className="mt-2 text-[11px] muted">
                Demo listing from the bundled sample dataset — not a real business.
              </p>
            )}
          </div>

          <Link to="/near-me" className="btn-ghost w-full">← Back to nearby places</Link>
        </aside>
      </div>

      <CheckInDialog place={restaurant} open={checkInOpen} onClose={() => setCheckInOpen(false)} onDone={run} />
      <CrowdReportDialog
        place={restaurant}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onDone={() => { run(); outlook.run(); }}
      />
    </div>
  );
}

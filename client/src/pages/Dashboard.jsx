import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useLocation } from '../context/LocationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ContextStrip } from '../components/ContextStrip.jsx';
import { RecommendationTile } from '../components/RecommendationCard.jsx';
import { RestaurantCard } from '../components/RestaurantCard.jsx';
import { EmptyState, ErrorState, SectionHeader, SkeletonGrid } from '../components/ui.jsx';
import { orderStatusLabel, relativeTime, rupees } from '../lib/format.js';

const ENTRY_POINTS = [
  {
    to: '/decide',
    emoji: '🍽️',
    title: 'What should I eat?',
    body: 'Tell us your mood, hunger, budget and diet. We rank the actual menu against them.',
    gradient: 'from-brand-500 to-rose-600',
  },
  {
    to: '/ask',
    emoji: '💬',
    title: 'Ask the assistant',
    body: '“I’m very hungry and I have only ₹150.” Say it in your own words.',
    gradient: 'from-violet-500 to-indigo-600',
  },
  {
    to: '/near-me',
    emoji: '📍',
    title: 'Where should I eat?',
    body: 'Nearby places ranked by distance, price and how busy they are right now.',
    gradient: 'from-emerald-500 to-teal-600',
  },
];

export default function Dashboard() {
  const { location } = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const { data, loading, error, run } = useAsync(
    () => api.dashboard(location ? { lat: location.lat, lng: location.lng } : {}),
    [location?.lat, location?.lng]
  );

  const addToCart = (item) => {
    const { replaced } = add(item.food, item.restaurant, 1);
    toast.success(replaced ? `Cart replaced with ${item.food.name}` : `${item.food.name} added to cart`);
  };

  return (
    <div className="space-y-8">
      <section className="animate-fade-up">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 dark:text-ink-50 sm:text-3xl">
          {isAuthenticated ? `Hey ${user.name.split(' ')[0]} 👋` : 'Don’t know what to eat?'}
        </h1>
        <p className="mt-1 max-w-2xl text-sm muted sm:text-base">
          Food AI decides <strong className="font-semibold text-ink-700 dark:text-ink-300">what</strong> to eat,{' '}
          <strong className="font-semibold text-ink-700 dark:text-ink-300">where</strong> to eat, and whether to order
          in or head out — using your situation, not an endless menu.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {ENTRY_POINTS.map((entry) => (
          <Link
            key={entry.to}
            to={entry.to}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${entry.gradient} p-5 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg`}
          >
            <div className="text-3xl" aria-hidden="true">{entry.emoji}</div>
            <h2 className="mt-2 text-base font-bold">{entry.title}</h2>
            <p className="mt-1 text-sm text-white/85">{entry.body}</p>
            <span className="mt-3 inline-block text-sm font-bold">Start →</span>
          </Link>
        ))}
      </div>

      <ContextStrip context={data?.context} loading={loading} />

      {error ? (
        <ErrorState error={error} onRetry={run} />
      ) : (
        <>
          <section>
            <SectionHeader
              title="Personalised for you"
              subtitle={
                data?.context?.isPersonalised
                  ? 'Ranked against your saved preferences and past choices.'
                  : 'Sign in to have these ranked against your own tastes.'
              }
              action={<Link to="/decide" className="btn-ghost text-sm">Refine →</Link>}
            />
            {loading ? (
              <SkeletonGrid count={3} lines={2} />
            ) : data?.recommendedFoods?.length ? (
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
                {data.recommendedFoods.map((item) => (
                  <RecommendationTile key={item.id} item={item} onClick={addToCart} />
                ))}
              </div>
            ) : (
              <EmptyState
                emoji="🔍"
                title="Nothing open nearby right now"
                description="Try widening your distance, or check back at the next mealtime."
                action={<Link to="/near-me" className="btn-primary mt-2">Browse nearby</Link>}
              />
            )}
          </section>

          <section>
            <SectionHeader
              title="Good places near you"
              subtitle="Ranked by distance, rating and how busy they are right now."
              action={<Link to="/near-me" className="btn-ghost text-sm">See all →</Link>}
            />
            {loading ? (
              <SkeletonGrid count={3} />
            ) : data?.recommendedRestaurants?.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.recommendedRestaurants.slice(0, 6).map((place) => (
                  <RestaurantCard key={place.id} place={place} />
                ))}
              </div>
            ) : (
              <EmptyState emoji="📍" title="No open restaurants in range" description="Widen the radius on the Near me screen." />
            )}
          </section>

          {isAuthenticated && data?.recentOrders?.length > 0 && (
            <section>
              <SectionHeader title="Recently ordered" action={<Link to="/orders" className="btn-ghost text-sm">All orders →</Link>} />
              <div className="grid gap-3 sm:grid-cols-2">
                {data.recentOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => navigate(`/orders/${order.id}`)}
                    className="card card-hover flex items-center gap-3 p-4 text-left"
                  >
                    <span className="text-3xl" aria-hidden="true">{order.emoji ?? '🍽️'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{order.restaurantName}</p>
                      <p className="truncate text-xs muted">{order.items.join(', ')}</p>
                      <p className="mt-0.5 text-xs muted">
                        {orderStatusLabel(order.status)} · {relativeTime(order.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-extrabold">{rupees(order.total)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {isAuthenticated && (data?.favoriteFoods?.length > 0 || data?.favoriteRestaurants?.length > 0) && (
            <section>
              <SectionHeader title="Your favourites" />
              <div className="flex flex-wrap gap-2">
                {data.favoriteRestaurants.map((place) => (
                  <Link key={place.id} to={`/restaurant/${place.id}`} className="chip-idle">
                    <span aria-hidden="true">{place.emoji}</span> {place.name}
                  </Link>
                ))}
                {data.favoriteFoods.map((food) => (
                  <span key={food.id} className="chip-idle">
                    <span aria-hidden="true">{food.emoji}</span> {food.name} · {rupees(food.price)}
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

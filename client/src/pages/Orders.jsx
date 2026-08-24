import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Badge, EmptyState, ErrorState, SectionHeader, SkeletonGrid } from '../components/ui.jsx';
import { orderStatusLabel, relativeTime, rupees } from '../lib/format.js';

const STATUS_TONE = {
  placed: 'neutral',
  confirmed: 'brand',
  preparing: 'amber',
  out_for_delivery: 'brand',
  ready_for_pickup: 'brand',
  delivered: 'green',
  cancelled: 'rose',
};

export default function Orders() {
  const { data, loading, error, run } = useAsync(() => api.orders(), []);

  if (loading) return <SkeletonGrid count={3} lines={2} />;
  if (error) return <ErrorState error={error} onRetry={run} />;

  const orders = data?.orders ?? [];

  if (!orders.length) {
    return (
      <EmptyState
        emoji="🧾"
        title="No orders yet"
        description="Once you order something it shows up here with live status."
        action={<Link to="/decide" className="btn-primary mt-2">Find something to eat</Link>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Your orders" subtitle={`${orders.length} order${orders.length === 1 ? '' : 's'}`} />
      <div className="space-y-3">
        {orders.map((order) => (
          <Link key={order.id} to={`/orders/${order.id}`} className="card card-hover block p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden="true">{order.restaurant?.emoji ?? '🍽️'}</span>
                  <h3 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{order.restaurant?.name}</h3>
                  <Badge tone={STATUS_TONE[order.status] ?? 'neutral'}>{orderStatusLabel(order.status)}</Badge>
                </div>
                <p className="mt-1 truncate text-xs muted">
                  {order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
                </p>
                <p className="mt-0.5 text-xs muted">
                  #{order.orderNumber} · {relativeTime(order.createdAt)} · {order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}
                </p>
              </div>
              <span className="shrink-0 text-base font-extrabold tabular-nums">{rupees(order.pricing.total)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

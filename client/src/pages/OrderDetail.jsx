import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import { Badge, ErrorState, Loading } from '../components/ui.jsx';
import { cx, minutes, orderStatusLabel, relativeTime, rupees } from '../lib/format.js';

const DELIVERY_STEPS = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const PICKUP_STEPS = ['placed', 'confirmed', 'preparing', 'ready_for_pickup'];

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, run } = useAsync(() => api.order(id), [id]);

  const order = data?.order;
  const isLive = order && !['delivered', 'cancelled'].includes(order.status);

  // Status advances with time on the server; poll while the order is live.
  useEffect(() => {
    if (!isLive) return undefined;
    const timer = setInterval(run, 20000);
    return () => clearInterval(timer);
  }, [isLive, run]);

  if (loading) return <Loading label="Loading order…" />;
  if (error) return <ErrorState error={error} onRetry={run} />;
  if (!order) return null;

  const steps = order.fulfilment === 'delivery' ? DELIVERY_STEPS : PICKUP_STEPS;
  const currentIndex = steps.indexOf(order.status);

  const cancel = async () => {
    try {
      await api.cancelOrder(order.id);
      toast.success('Order cancelled.');
      run();
    } catch (requestError) {
      toast.error(requestError.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Order #{order.orderNumber}</h1>
          <p className="text-sm muted">
            {order.restaurant?.name} · {relativeTime(order.createdAt)}
          </p>
        </div>
        <Link to="/orders" className="btn-ghost text-sm">← All orders</Link>
      </div>

      {order.status === 'cancelled' ? (
        <div className="card border-rose-200 p-4 dark:border-rose-900">
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300">This order was cancelled.</p>
          {order.payment.status === 'refunded' && (
            <p className="mt-1 text-xs muted">The simulated payment has been marked refunded.</p>
          )}
        </div>
      ) : (
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-bold">{orderStatusLabel(order.status)}</span>
            {order.etaMinutes != null && currentIndex < steps.length - 1 && (
              <span className="text-sm muted">ETA about {minutes(order.etaMinutes)} from ordering</span>
            )}
          </div>

          <ol className="relative flex justify-between">
            <div className="absolute left-0 right-0 top-3 h-0.5 bg-ink-200 dark:bg-ink-800" aria-hidden="true" />
            <div
              className="absolute left-0 top-3 h-0.5 bg-brand-600 transition-all duration-700"
              style={{ width: `${(Math.max(0, currentIndex) / (steps.length - 1)) * 100}%` }}
              aria-hidden="true"
            />
            {steps.map((step, index) => (
              <li key={step} className="relative z-10 flex flex-1 flex-col items-center gap-1.5 text-center">
                <span
                  className={cx(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                    index <= currentIndex ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
                  )}
                >
                  {index < currentIndex ? '✓' : index + 1}
                </span>
                <span className={cx('text-[10px] font-semibold leading-tight', index <= currentIndex ? 'text-ink-800 dark:text-ink-200' : 'muted')}>
                  {orderStatusLabel(step)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card space-y-3 p-4 lg:col-span-2">
          <h2 className="text-sm font-bold">Items</h2>
          <ul className="space-y-2">
            {order.items.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  <span aria-hidden="true">{item.emoji}</span> {item.quantity}× {item.name}
                </span>
                <span className="shrink-0 tabular-nums">{rupees(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          {order.deliveryAddress?.line1 && (
            <div className="border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
              <h3 className="text-xs font-bold uppercase tracking-wide muted">Delivering to</h3>
              <p className="mt-1">
                {order.deliveryAddress.line1}
                {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''}
                {order.deliveryAddress.city ? `, ${order.deliveryAddress.city}` : ''}
                {order.deliveryAddress.pincode ? ` ${order.deliveryAddress.pincode}` : ''}
              </p>
            </div>
          )}

          {order.notes && (
            <div className="border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
              <h3 className="text-xs font-bold uppercase tracking-wide muted">Notes</h3>
              <p className="mt-1 muted">{order.notes}</p>
            </div>
          )}

          <div className="border-t border-ink-100 pt-3 dark:border-ink-800">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide muted">Timeline</h3>
            <ul className="space-y-1 text-xs muted">
              {order.statusHistory?.map((entry, index) => (
                <li key={`${entry.status}-${index}`}>
                  {orderStatusLabel(entry.status)} — {relativeTime(entry.at)}
                  {entry.note ? ` · ${entry.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="card h-fit space-y-3 p-4">
          <h2 className="text-sm font-bold">Bill</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd className="tabular-nums">{rupees(order.pricing.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="muted">Delivery</dt><dd className="tabular-nums">{order.pricing.deliveryFee ? rupees(order.pricing.deliveryFee) : 'Free'}</dd></div>
            <div className="flex justify-between"><dt className="muted">Taxes</dt><dd className="tabular-nums">{rupees(order.pricing.taxes)}</dd></div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-extrabold dark:border-ink-800">
              <dt>Total</dt><dd className="tabular-nums">{rupees(order.pricing.total)}</dd>
            </div>
          </dl>

          <div className="flex items-center gap-2">
            <Badge tone={order.payment.status === 'paid' ? 'green' : 'neutral'}>{order.payment.status}</Badge>
            <span className="text-xs muted">{order.payment.method.replace('demo_', '').toUpperCase()}</span>
          </div>
          {order.payment.isSimulated && (
            <p className="text-[11px] muted">Simulated payment — reference {order.payment.reference}. No money moved.</p>
          )}

          {!['delivered', 'cancelled', 'out_for_delivery', 'ready_for_pickup'].includes(order.status) && (
            <button type="button" className="btn-secondary w-full text-rose-600" onClick={cancel}>
              Cancel order
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

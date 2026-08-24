import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, SectionHeader } from '../components/ui.jsx';
import { rupees } from '../lib/format.js';

export default function Cart() {
  const { restaurant, items, setQuantity, remove, clear, totals } = useCart();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (!items.length) {
    return (
      <EmptyState
        emoji="🛒"
        title="Your cart is empty"
        description="Find something you actually feel like eating first."
        action={<Link to="/decide" className="btn-primary mt-2">Help me decide</Link>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Your cart"
        subtitle={restaurant ? `From ${restaurant.name}` : undefined}
        action={<button type="button" className="btn-ghost text-sm text-rose-600" onClick={clear}>Clear cart</button>}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {items.map(({ food, quantity }) => (
            <div key={food.id} className="card flex items-center gap-3 p-4">
              <span className="text-3xl" aria-hidden="true">{food.emoji}</span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{food.name}</h3>
                <p className="text-xs muted">{rupees(food.price)} each</p>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-ink-200 dark:border-ink-700">
                <button
                  type="button"
                  className="px-3 py-1.5 text-lg leading-none"
                  onClick={() => setQuantity(food.id, quantity - 1)}
                  aria-label={`Reduce ${food.name}`}
                >
                  −
                </button>
                <span className="min-w-[24px] text-center text-sm font-bold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  className="px-3 py-1.5 text-lg leading-none"
                  onClick={() => setQuantity(food.id, Math.min(20, quantity + 1))}
                  aria-label={`Add another ${food.name}`}
                >
                  +
                </button>
              </div>

              <span className="w-16 shrink-0 text-right text-sm font-extrabold tabular-nums">
                {rupees(food.price * quantity)}
              </span>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs text-rose-600"
                onClick={() => remove(food.id)}
                aria-label={`Remove ${food.name}`}
              >
                ✕
              </button>
            </div>
          ))}

          <p className="text-xs muted">
            All items in one order must come from the same restaurant. Adding a dish from somewhere else replaces
            the cart.
          </p>
        </div>

        <aside className="card h-fit space-y-3 p-4">
          <h3 className="text-sm font-bold">Bill summary</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="muted">Subtotal</dt>
              <dd className="tabular-nums">{rupees(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Delivery</dt>
              <dd className="tabular-nums">{totals.deliveryFee ? rupees(totals.deliveryFee) : 'Free'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Taxes (5%)</dt>
              <dd className="tabular-nums">{rupees(totals.taxes)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-extrabold dark:border-ink-800">
              <dt>Total</dt>
              <dd className="tabular-nums">{rupees(totals.total)}</dd>
            </div>
          </dl>

          {totals.freeDeliveryGap > 0 && (
            <p className="text-xs muted">Add {rupees(totals.freeDeliveryGap)} more for free delivery.</p>
          )}

          <button type="button" className="btn-primary w-full" onClick={() => navigate(isAuthenticated ? '/checkout' : '/login')}>
            {isAuthenticated ? 'Proceed to checkout' : 'Sign in to check out'}
          </button>

          <p className="text-center text-[11px] muted">
            Demo checkout — no real payment is taken and no card details are collected.
          </p>
        </aside>
      </div>
    </div>
  );
}
